const { query } = require('../db');
const scheduling = require('./interviewSchedulingService');
const googleWorkspace = require('./googleWorkspaceService');

function overlaps(start, end, busy) {
  return busy.some(item => start < new Date(item.end) && end > new Date(item.start));
}

function parsePreferredStart(value, timezone = 'UTC') {
  const text = String(value || '').trim();
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(text)) return new Date(text);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return new Date('invalid');
  const [, year, month, day, hour, minute, second = '00'] = match;
  const expected = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  let instant = new Date(expected);
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(format.formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const actual = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant = new Date(instant.getTime() + expected - actual);
  }
  return instant;
}

function schedulingValidation(assignment, timezone = 'UTC') {
  const errors = scheduling.validateAssignment(assignment);
  if (!assignment.preferred_start) errors.push('Preferred start is missing');
  else if (Number.isNaN(parsePreferredStart(assignment.preferred_start, timezone).getTime())) errors.push('Preferred start is invalid');
  return errors;
}

async function getAutomationSettings(organizationId) {
  const result = await query(
    `SELECT enabled, enabled_at, enabled_by_user_id FROM interview_scheduling_automation_settings WHERE organization_id = $1`,
    [organizationId]
  );
  return result.rows[0] || { enabled: false, enabled_at: null, enabled_by_user_id: null };
}

async function setAutomationEnabled({ organizationId, userId, enabled }) {
  const result = await query(
    `INSERT INTO interview_scheduling_automation_settings (organization_id, enabled, enabled_by_user_id, enabled_at)
     VALUES ($1, $2, $3, CASE WHEN $2 THEN NOW() ELSE NULL END)
     ON CONFLICT (organization_id) DO UPDATE SET enabled = EXCLUDED.enabled,
       enabled_by_user_id = CASE WHEN EXCLUDED.enabled THEN EXCLUDED.enabled_by_user_id ELSE interview_scheduling_automation_settings.enabled_by_user_id END,
       enabled_at = CASE WHEN EXCLUDED.enabled THEN NOW() ELSE NULL END
     RETURNING enabled, enabled_at, enabled_by_user_id`,
    [organizationId, Boolean(enabled), userId]
  );
  return result.rows[0];
}

async function getAutomationStatus(organizationId) {
  const [settings, counts, recent, reschedules] = await Promise.all([
    getAutomationSettings(organizationId),
    query(`SELECT status, COUNT(*)::int AS count FROM interview_schedule_executions WHERE organization_id = $1 GROUP BY status`, [organizationId]),
    query(`SELECT id, source_assignment_id, source_snapshot, requested_start, duration_minutes, status, meeting_url, failure_reason, scheduled_at, reschedule_count, last_rescheduled_at, created_at
      FROM interview_schedule_executions WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 20`, [organizationId]),
    query(`SELECT COALESCE(SUM(reschedule_count), 0)::int AS count FROM interview_schedule_executions WHERE organization_id = $1`, [organizationId]),
  ]);
  const summary = { pending: 0, processing: 0, scheduled: 0, conflict: 0, failed: 0, rescheduled: reschedules.rows[0].count };
  counts.rows.forEach(row => { summary[row.status] = row.count; });
  return { settings, summary, executions: recent.rows };
}

async function retryUnsuccessfulExecutions(organizationId) {
  const result = await query(
    `UPDATE interview_schedule_executions SET status = 'pending', failure_reason = NULL
     WHERE organization_id = $1 AND status IN ('failed', 'conflict') RETURNING id`,
    [organizationId]
  );
  return result.rowCount;
}

async function claimExecution({ organizationId, assignment, start }) {
  const result = await query(
    `INSERT INTO interview_schedule_executions (organization_id, source_assignment_id, source_snapshot, requested_start, duration_minutes, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (organization_id, source_assignment_id) DO UPDATE SET
       source_snapshot = EXCLUDED.source_snapshot,
       requested_start = EXCLUDED.requested_start,
       duration_minutes = EXCLUDED.duration_minutes
     WHERE interview_schedule_executions.status = 'pending'
     RETURNING *`,
    [organizationId, assignment.id, JSON.stringify(assignment), start.toISOString(), assignment.duration_minutes]
  );
  return result.rows[0] || null;
}

async function markExecution(id, status, extra = {}) {
  const result = await query(
    `UPDATE interview_schedule_executions SET status = $2::varchar, google_event_id = COALESCE($3, google_event_id),
       meeting_url = COALESCE($4, meeting_url), failure_reason = $5,
       scheduled_at = CASE WHEN $2::varchar = 'scheduled' THEN NOW() ELSE scheduled_at END,
       attempt_count = CASE WHEN $2::varchar = 'processing' THEN attempt_count + 1 ELSE attempt_count END
     WHERE id = $1 RETURNING *`,
    [id, status, extra.googleEventId || null, extra.meetingUrl || null, extra.failureReason || null]
  );
  return result.rows[0];
}

async function archiveRelatedProposals({ organizationId, assignmentId, executionId, proposalId = null }) {
  const whereProposal = proposalId ? 'AND id = $4' : '';
  await query(
    `UPDATE interview_schedule_proposals SET status = 'superseded', scheduled_execution_id = $3
     WHERE organization_id = $1 AND source_assignment_id = $2 AND status IN ('draft', 'selected') ${whereProposal}`,
    proposalId ? [organizationId, assignmentId, executionId, proposalId] : [organizationId, assignmentId, executionId]
  );
}

async function processAssignment({ organizationId, config, assignment, selectedStart = null, proposalId = null }) {
  const errors = scheduling.validateAssignment(assignment);
  const start = selectedStart ? new Date(selectedStart) : parsePreferredStart(assignment.preferred_start, config.timezone);
  if (!selectedStart && !assignment.preferred_start) errors.push('Preferred start is missing');
  if (Number.isNaN(start.getTime())) errors.push('Preferred start is invalid');
  if (errors.length) return { outcome: 'invalid', reason: errors.join('. ') };
  const end = new Date(start.getTime() + assignment.duration_minutes * 60000);
  const existingExecution = await getExecutionBySource({ organizationId, assignmentId: assignment.id });
  if (existingExecution?.status === 'scheduled') {
    return rescheduleExecution({ organizationId, config, assignment, execution: existingExecution, start, end });
  }
  const execution = await claimExecution({ organizationId, assignment, start });
  if (!execution) return { outcome: 'skipped' };
  try {
    await markExecution(execution.id, 'processing');
    const busy = await googleWorkspace.getBusyIntervals({
      organizationId, rangeStart: start.toISOString(), rangeEnd: end.toISOString(), interviewerEmail: assignment.interviewer_email, timezone: config.timezone,
    });
    if (overlaps(start, end, busy)) {
      await markExecution(execution.id, 'conflict', { failureReason: 'Interviewer is busy at the preferred start time' });
      return { outcome: 'conflict' };
    }
    const event = await googleWorkspace.createInterviewEvent({
      organizationId, executionId: execution.id, assignment, start: start.toISOString(), end: end.toISOString(), timezone: config.timezone,
    });
    await markExecution(execution.id, 'scheduled', { googleEventId: event.eventId, meetingUrl: event.meetingUrl });
    await archiveRelatedProposals({ organizationId, assignmentId: assignment.id, executionId: execution.id, proposalId });
    return { outcome: 'scheduled', execution: await getExecution(execution.id) };
  } catch (error) {
    await markExecution(execution.id, 'failed', { failureReason: 'Unable to create the Calendar event. Check the organization Google connection and retry after fixing it.' });
    console.error('[AutomaticScheduling] Execution failed', { executionId: execution.id, message: error.message });
    return { outcome: 'failed' };
  }
}

async function getExecution(executionId) {
  const result = await query('SELECT * FROM interview_schedule_executions WHERE id = $1', [executionId]);
  return result.rows[0] || null;
}

async function getExecutionBySource({ organizationId, assignmentId }) {
  const result = await query(
    `SELECT * FROM interview_schedule_executions WHERE organization_id = $1 AND source_assignment_id = $2`,
    [organizationId, assignmentId]
  );
  return result.rows[0] || null;
}

function schedulingFingerprint(assignment, start) {
  return JSON.stringify({
    candidate_name: assignment.candidate_name || '', candidate_email: assignment.candidate_email || '',
    interviewer_email: assignment.interviewer_email || '', purpose: assignment.purpose || '',
    duration_minutes: Number(assignment.duration_minutes) || 60, start: start.toISOString(),
  });
}

async function rescheduleExecution({ organizationId, config, assignment, execution, start, end }) {
  const existingFingerprint = schedulingFingerprint(execution.source_snapshot || {}, new Date(execution.requested_start));
  const desiredFingerprint = schedulingFingerprint(assignment, start);
  if (existingFingerprint === desiredFingerprint) return { outcome: 'skipped' };
  if (!execution.google_event_id) return { outcome: 'skipped' };
  try {
    const event = await googleWorkspace.updateInterviewEvent({
      organizationId, eventId: execution.google_event_id, assignment, start: start.toISOString(), end: end.toISOString(), timezone: config.timezone,
    });
    await query(
      `UPDATE interview_schedule_executions SET source_snapshot = $2, requested_start = $3, duration_minutes = $4,
       meeting_url = COALESCE($5, meeting_url), reschedule_count = reschedule_count + 1, last_rescheduled_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [execution.id, JSON.stringify(assignment), start.toISOString(), assignment.duration_minutes, event.meetingUrl]
    );
    await query(
      `INSERT INTO interview_schedule_audit_events (execution_id, event_type, previous_start, new_start)
       VALUES ($1, 'rescheduled', $2, $3)`,
      [execution.id, execution.requested_start, start.toISOString()]
    );
    return { outcome: 'rescheduled', execution: await getExecution(execution.id) };
  } catch (error) {
    console.error('[AutomaticScheduling] Reschedule failed', { executionId: execution.id, message: error.message });
    return { outcome: 'failed' };
  }
}

async function scheduleSelectedProposal({ organizationId, proposalId }) {
  const result = await query(
    `SELECT id, source_assignment_id, source_snapshot, selected_slot, status
     FROM interview_schedule_proposals WHERE id = $1 AND organization_id = $2`,
    [proposalId, organizationId]
  );
  const proposal = result.rows[0];
  if (!proposal || proposal.status !== 'selected' || !proposal.selected_slot?.start) throw new Error('Select a proposal time before scheduling it');
  const config = await scheduling.getConfiguration(organizationId);
  if (config.source !== 'google') throw new Error('Manual event scheduling requires a connected Google Sheet configuration');
  const connection = await googleWorkspace.status(organizationId);
  if (connection.status !== 'connected' || connection.needs_reconnect) throw new Error('Reconnect Google Workspace with Calendar event permission before scheduling');
  const outcome = await processAssignment({
    organizationId, config, assignment: proposal.source_snapshot, selectedStart: proposal.selected_slot.start, proposalId: proposal.id,
  });
  if (outcome.outcome === 'skipped') throw new Error('This interview already has a scheduling record');
  if (outcome.outcome !== 'scheduled') throw new Error(outcome.reason || 'Unable to schedule the selected interview');
  return { proposal: { ...proposal, status: 'superseded', scheduled_execution_id: outcome.execution.id }, execution: outcome.execution };
}

async function runOrganizationAutomation(organizationId) {
  const settings = await getAutomationSettings(organizationId);
  if (!settings.enabled) return { skipped: true, reason: 'Automation is disabled' };
  const config = await scheduling.getConfiguration(organizationId);
  if (config.source !== 'google') return { skipped: true, reason: 'A Google Sheet is required for automatic scheduling' };
  const connection = await googleWorkspace.status(organizationId);
  if (connection.status !== 'connected' || connection.needs_reconnect) return { skipped: true, reason: 'Reconnect Google Workspace with Calendar event permission' };
  const assignments = await scheduling.listAssignments(organizationId);
  const outcomes = { scheduled: 0, rescheduled: 0, conflict: 0, failed: 0, skipped: 0, invalid: 0 };
  for (const assignment of assignments.filter(item => item.status === 'Ready to schedule')) {
    const result = await processAssignment({ organizationId, config, assignment });
    outcomes[result.outcome] = (outcomes[result.outcome] || 0) + 1;
  }
  return outcomes;
}

async function runAllEnabledAutomations() {
  const result = await query('SELECT organization_id FROM interview_scheduling_automation_settings WHERE enabled = TRUE');
  for (const row of result.rows) {
    try { await runOrganizationAutomation(row.organization_id); }
    catch (error) { console.error('[AutomaticScheduling] Organization run failed', { organizationId: row.organization_id, message: error.message }); }
  }
}

module.exports = { getAutomationSettings, setAutomationEnabled, getAutomationStatus, retryUnsuccessfulExecutions, runOrganizationAutomation, runAllEnabledAutomations, schedulingValidation, parsePreferredStart, processAssignment, scheduleSelectedProposal, archiveRelatedProposals };
