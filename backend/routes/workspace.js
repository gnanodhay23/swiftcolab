// Workspace Routes - Save and load user's app selections
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/workspace - Get user's saved workspace
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT ai_os_apps, work_os_apps, updated_at FROM user_workspaces WHERE user_id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        exists: false,
        aiOsApps: [],
        workOsApps: [],
      });
    }

    const workspace = result.rows[0];
    const aiOsApps = workspace.ai_os_apps || [];
    const workOsApps = workspace.work_os_apps || [];

    // Only consider workspace as "existing" if it has at least one app
    const hasApps = aiOsApps.length > 0 || workOsApps.length > 0;

    console.log('[Workspace] GET - aiOsApps:', aiOsApps.length, 'workOsApps:', workOsApps.length, 'hasApps:', hasApps);

    res.json({
      exists: hasApps,
      aiOsApps,
      workOsApps,
      updatedAt: workspace.updated_at,
    });
  } catch (error) {
    console.error('[Workspace] Get error:', error.message);
    res.status(500).json({ error: 'Failed to get workspace' });
  }
});

// POST /api/workspace - Save user's workspace (create or update)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { aiOsApps, workOsApps } = req.body;

    if (!Array.isArray(aiOsApps) || !Array.isArray(workOsApps)) {
      return res.status(400).json({ error: 'aiOsApps and workOsApps must be arrays' });
    }

    // Upsert - insert or update if exists
    const result = await query(
      `INSERT INTO user_workspaces (user_id, ai_os_apps, work_os_apps)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id)
       DO UPDATE SET ai_os_apps = $2, work_os_apps = $3, updated_at = NOW()
       RETURNING id, ai_os_apps, work_os_apps, updated_at`,
      [req.user.userId, JSON.stringify(aiOsApps), JSON.stringify(workOsApps)]
    );

    res.json({
      success: true,
      workspace: {
        aiOsApps: result.rows[0].ai_os_apps,
        workOsApps: result.rows[0].work_os_apps,
        updatedAt: result.rows[0].updated_at,
      },
    });
  } catch (error) {
    console.error('[Workspace] Save error:', error.message);
    res.status(500).json({ error: 'Failed to save workspace' });
  }
});

// DELETE /api/workspace - Delete user's workspace (reset to selection screen)
router.delete('/', authenticateToken, async (req, res) => {
  try {
    await query('DELETE FROM user_workspaces WHERE user_id = $1', [req.user.userId]);
    res.json({ success: true, message: 'Workspace deleted' });
  } catch (error) {
    console.error('[Workspace] Delete error:', error.message);
    res.status(500).json({ error: 'Failed to delete workspace' });
  }
});

module.exports = router;
