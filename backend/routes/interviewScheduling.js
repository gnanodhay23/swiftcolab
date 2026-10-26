const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { requireOrganization } = require('../middleware/organization');
const scheduling = require('../services/interviewSchedulingService');
const automation = require('../services/automaticInterviewSchedulingService');

const router = express.Router();
router.use(authenticateToken, requireOrganization());

router.get('/configuration', async (req, res) => {
  try { res.json({ configuration: await scheduling.getConfiguration(req.organization.organization_id) }); }
  catch { res.status(500).json({ error: 'Unable to load scheduling configuration' }); }
});

router.put('/configuration', requireOrganization(['owner', 'admin']), async (req, res) => {
  try { res.json({ configuration: await scheduling.saveConfiguration(req.organization.organization_id, req.body || {}) }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

router.get('/assignments', async (req, res) => {
  try {
    const overview = await scheduling.getAssignmentsOverview(req.organization.organization_id);
    res.json({ ...overview, readOnly: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Unable to read interview assignments' });
  }
});

router.get('/proposals', async (req, res) => {
  try { res.json({ proposals: await scheduling.listProposals(req.organization.organization_id), readOnly: true }); }
  catch { res.status(500).json({ error: 'Unable to load proposals' }); }
});

router.get('/automation', async (req, res) => {
  try { res.json(await automation.getAutomationStatus(req.organization.organization_id)); }
  catch (error) { res.status(500).json({ error: error.message || 'Unable to load automatic scheduling status' }); }
});

router.put('/automation', requireOrganization(['owner', 'admin']), async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
  try {
    const settings = await automation.setAutomationEnabled({
      organizationId: req.organization.organization_id,
      userId: req.user.userId,
      enabled: req.body.enabled,
    });
    if (settings.enabled) {
      setImmediate(() => automation.runOrganizationAutomation(req.organization.organization_id)
        .catch(error => console.error('[AutomaticScheduling] Initial run failed', error.message)));
    }
    return res.json({ settings });
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

router.post('/automation/retry-unsuccessful', requireOrganization(['owner', 'admin']), async (req, res) => {
  try {
    const retried = await automation.retryUnsuccessfulExecutions(req.organization.organization_id);
    if (retried) {
      setImmediate(() => automation.runOrganizationAutomation(req.organization.organization_id)
        .catch(error => console.error('[AutomaticScheduling] Retry run failed', error.message)));
    }
    return res.json({ retried });
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

router.post('/proposals', requireOrganization(['owner', 'admin', 'member']), async (req, res) => {
  try {
    const proposal = await scheduling.createProposal({
      organizationId: req.organization.organization_id,
      requestedByUserId: req.user.userId,
      assignmentId: req.body?.assignmentId,
    });
    res.status(201).json({ proposal, readOnly: true });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.patch('/proposals/:proposalId', requireOrganization(['owner', 'admin', 'member']), async (req, res) => {
  try {
    const proposal = await scheduling.updateProposal({
      organizationId: req.organization.organization_id,
      proposalId: req.params.proposalId,
      status: req.body?.status,
      selectedSlot: req.body?.selectedSlot,
    });
    res.json({ proposal, readOnly: true });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/proposals/:proposalId/schedule', requireOrganization(['owner', 'admin']), async (req, res) => {
  try {
    const result = await automation.scheduleSelectedProposal({
      organizationId: req.organization.organization_id,
      proposalId: req.params.proposalId,
    });
    res.json(result);
  } catch (error) { res.status(400).json({ error: error.message }); }
});

module.exports = router;
