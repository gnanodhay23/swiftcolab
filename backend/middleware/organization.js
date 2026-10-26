const { requireMembership, listMembershipsForUser } = require('../services/organizationService');

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function requireOrganization(allowedRoles = []) {
  return async (req, res, next) => {
    try {
      let organizationId = req.get('X-Organization-Id');
      if (!organizationId) {
        const memberships = await listMembershipsForUser(req.user.userId);
        if (memberships.length !== 1) {
          return res.status(400).json({ error: 'Select an organization before continuing' });
        }
        organizationId = memberships[0].organization_id;
      }
      if (!isUuid(organizationId)) {
        return res.status(400).json({ error: 'X-Organization-Id must be a valid organization ID' });
      }
      if (req.params.organizationId && req.params.organizationId !== organizationId) {
        return res.status(400).json({ error: 'Organization path and X-Organization-Id must match' });
      }
      const membership = await requireMembership({
        organizationId,
        userId: req.user.userId,
        allowedRoles,
      });
      req.organization = membership;
      return next();
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  };
}

module.exports = { requireOrganization, isUuid };
