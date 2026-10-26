const { query } = require('../db');
const fixtureProvider = require('../fixtures/interviewSchedulingFixture');
const googleProvider = require('./googleWorkspaceService');

const DEFAULT_CONFIG = {
  timezone: 'UTC', workday_start: 9, workday_end: 18,
  default_duration_minutes: 60, buffer_minutes: 15,
  minimum_notice_hours: 24, search_days: 14,
};

function assertTimeZone(timezone) {
  try { Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { throw new Error('Invalid timezone'); }
  return timezone;
}

function validateConfiguration(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...input };
  config.source = input.source || 'fixture';
  config.spreadsheet_id = input.spreadsheet_id || null;
  config.sheet_range = input.sheet_range || 'Sheet1!A:G';
  if (!['fixture', 'google'].includes(config.source)) throw new Error('Invalid scheduling source');
  if (config.source === 'google' && !config.spreadsheet_id) throw new Error('Google Sheet link is required');
  config.timezone = assertTimeZone(config.timezone);
  for (const field of ['workday_start', 'workday_end', 'default_duration_minutes', 'buffer_minutes', 'minimum_notice_hours', 'search_days']) {
    config[field] = Number(config[field]);
    if (!Number.isInteger(config[field])) throw new Error(`Invalid ${field}`);
  }
  if (config.workday_start < 0 || config.workday_end > 24 || config.workday_end <= config.workday_start) throw new Error('Invalid working hours');
  if (config.default_duration_minutes < 15 || config.default_duration_minutes > 240) throw new Error('Invalid interview duration');
  if (config.buffer_minutes < 0 || config.buffer_minutes > 120 || config.minimum_notice_hours < 0 || config.search_days < 1 || config.search_days > 60) throw new Error('Invalid scheduling configuration');
  return config;
}

async function getConfiguration(organizationId) {
  const result = await query('SELECT * FROM interview_scheduling_configs WHERE organization_id = $1', [organizationId]);
  return result.rows[0] || { organization_id: organizationId, ...DEFAULT_CONFIG };
}

async function saveConfiguration(organizationId, input) {
  const config = validateConfiguration(input);
  const result = await query(
    `INSERT INTO interview_scheduling_configs (organization_id, timezone, workday_start, workday_end, default_duration_minutes, buffer_minutes, minimum_notice_hours, search_days, source, spreadsheet_id, sheet_range)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone, workday_start = EXCLUDED.workday_start,
       workday_end = EXCLUDED.workday_end, default_duration_minutes = EXCLUDED.default_duration_minutes,
       buffer_minutes = EXCLUDED.buffer_minutes, minimum_notice_hours = EXCLUDED.minimum_notice_hours, search_days = EXCLUDED.search_days, source = EXCLUDED.source, spreadsheet_id = EXCLUDED.spreadsheet_id, sheet_range = EXCLUDED.sheet_range
     RETURNING *`,
    [organizationId, config.timezone, config.workday_start, config.workday_end, config.default_duration_minutes, config.buffer_minutes, config.minimum_notice_hours, config.search_days, config.source, googleProvider.spreadsheetId(config.spreadsheet_id), config.sheet_range]
  );
  return result.rows[0];
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}

function overlaps(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && aEnd > bStart; }

function findAvailableSlots({ now = new Date(), config, busyIntervals, durationMinutes }) {
  const rangeStart = new Date(now.getTime() + config.minimum_notice_hours * 3600000);
  const rangeEnd = new Date(now.getTime() + config.search_days * 86400000);
  const busy = busyIntervals.map(item => ({ start: new Date(item.start), end: new Date(item.end) }));
  const slots = [];
  const conflicts = new Set();
  for (let cursor = new Date(rangeStart); cursor < rangeEnd && slots.length < 3; cursor = new Date(cursor.getTime() + 15 * 60000)) {
    if (cursor.getUTCMinutes() % 15 !== 0) continue;
    const end = new Date(cursor.getTime() + durationMinutes * 60000);
    const parts = localParts(cursor, config.timezone);
    const hour = Number(parts.hour);
    const endParts = localParts(end, config.timezone);
    const endMinutes = Number(endParts.hour) * 60 + Number(endParts.minute);
    if (['Sat', 'Sun'].includes(parts.weekday) || hour < config.workday_start || hour >= config.workday_end || endMinutes > config.workday_end * 60) continue;
    const bufferedStart = new Date(cursor.getTime() - config.buffer_minutes * 60000);
    const bufferedEnd = new Date(end.getTime() + config.buffer_minutes * 60000);
    if (busy.some(item => overlaps(bufferedStart, bufferedEnd, item.start, item.end))) { conflicts.add('Interviewer is busy during some available times'); continue; }
    slots.push({ start: cursor.toISOString(), end: end.toISOString(), timezone: config.timezone });
  }
  if (!slots.length) conflicts.add('No suitable time was found within the configured search window');
  return { slots, conflicts: [...conflicts] };
}

function validateAssignment(assignment) {
  const errors = [];
  if (!assignment?.candidate_name) errors.push('Candidate name is missing');
  if (!assignment?.candidate_email) errors.push('Candidate email is missing');
  if (!assignment?.interviewer_email) errors.push('Interviewer email is missing');
  if (assignment?.status !== 'Ready to schedule') errors.push('Assignment is not ready to schedule');
  return errors;
}

async function listAssignments(organizationId = null) {
  return (await getAssignmentsOverview(organizationId)).assignments;
}

function withValidation(assignments) {
  return assignments.map(item => ({ ...item, validation_errors: validateAssignment(item), eligible: validateAssignment(item).length === 0 }));
}

async function getAssignmentsOverview(organizationId = null) {
  const config = organizationId ? await getConfiguration(organizationId) : null;
  if (config?.source === 'google') {
    const sheet = await googleProvider.readSheet({ organizationId, spreadsheet: config.spreadsheet_id, range: config.sheet_range });
    return { source: 'google', assignments: withValidation(sheet.assignments), sheet: { headers: sheet.headers, previewRows: sheet.previewRows, rowCount: sheet.rowCount, warnings: sheet.warnings } };
  }
  return { source: 'fixture', assignments: withValidation(await fixtureProvider.listAssignments()), sheet: null };
}

async function createProposal({ organizationId, requestedByUserId, assignmentId }) {
  const assignments = await listAssignments(organizationId);
  const assignment = assignments.find(item => item.id === assignmentId);
  if (!assignment) throw new Error('Interview assignment not found');
  const validationErrors = validateAssignment(assignment);
  if (validationErrors.length) throw new Error(validationErrors.join('. '));
  const config = await getConfiguration(organizationId);
  const durationMinutes = assignment.duration_minutes || config.default_duration_minutes;
  const rangeStart = new Date(Date.now() + config.minimum_notice_hours * 3600000).toISOString();
  const rangeEnd = new Date(Date.now() + config.search_days * 86400000).toISOString();
  const busyIntervals = config.source === 'google'
    ? await googleProvider.getBusyIntervals({ organizationId, rangeStart, rangeEnd, interviewerEmail: assignment.interviewer_email, timezone: config.timezone })
    : await fixtureProvider.getBusyIntervals({ rangeStart, interviewerEmail: assignment.interviewer_email });
  const availability = findAvailableSlots({ config, busyIntervals, durationMinutes });
  const result = await query(
    `INSERT INTO interview_schedule_proposals (organization_id, requested_by_user_id, source_assignment_id, source_snapshot, timezone, duration_minutes, proposed_slots, conflict_reasons)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [organizationId, requestedByUserId, assignmentId, JSON.stringify(assignment), config.timezone, durationMinutes, JSON.stringify(availability.slots), JSON.stringify(availability.conflicts)]
  );
  return result.rows[0];
}

async function listProposals(organizationId) {
  const result = await query(`SELECT * FROM interview_schedule_proposals
    WHERE organization_id = $1 AND status <> 'superseded' ORDER BY created_at DESC`, [organizationId]);
  return result.rows;
}

async function updateProposal({ organizationId, proposalId, status, selectedSlot }) {
  if (!['selected', 'rejected'].includes(status)) throw new Error('Proposal status must be selected or rejected');
  if (status === 'selected' && !selectedSlot?.start) throw new Error('A selected slot is required');
  const result = await query(
    `UPDATE interview_schedule_proposals SET status = $3, selected_slot = $4
     WHERE id = $1 AND organization_id = $2 AND status = 'draft' RETURNING *`,
    [proposalId, organizationId, status, selectedSlot ? JSON.stringify(selectedSlot) : null]
  );
  if (!result.rowCount) throw new Error('Draft proposal not found');
  return result.rows[0];
}

module.exports = { DEFAULT_CONFIG, validateConfiguration, validateAssignment, findAvailableSlots, getConfiguration, saveConfiguration, listAssignments, getAssignmentsOverview, createProposal, listProposals, updateProposal };
