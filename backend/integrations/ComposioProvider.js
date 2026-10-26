const { assertIntegrationProvider } = require('./IntegrationProvider');

/**
 * Adapts the existing ComposioService to the vendor-neutral provider contract.
 * It intentionally preserves current behaviour while future providers are
 * added behind the same interface.
 */
class ComposioProvider {
  constructor(composioService) {
    this.id = 'composio';
    this.composioService = composioService;
    assertIntegrationProvider(this);
  }

  supportsAction(actionName) {
    return typeof actionName === 'string' && actionName.length > 0;
  }

  async initiateConnection({ toolkit, redirectUrl, connectionParams, entityId }) {
    return this.composioService.initiateConnection(
      toolkit,
      redirectUrl || null,
      connectionParams || {},
      entityId
    );
  }

  async getConnectionStatus({ toolkits, entityId }) {
    return this.composioService.listConnectedAccounts(toolkits || [], entityId);
  }

  async executeAction({ actionName, params, entityId }) {
    return this.composioService.executeAction(actionName, params, entityId);
  }
}

module.exports = { ComposioProvider };
