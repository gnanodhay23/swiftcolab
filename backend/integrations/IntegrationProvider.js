/**
 * Vendor-neutral contract for connected business applications.
 *
 * All future providers (Composio, direct Google OAuth, Microsoft Graph, etc.)
 * must implement this contract. It keeps orchestration code independent from
 * a single OAuth/integration vendor.
 */
const REQUIRED_METHODS = [
  'supportsAction',
  'initiateConnection',
  'getConnectionStatus',
  'executeAction',
];

function assertIntegrationProvider(provider) {
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) {
    throw new TypeError('Integration provider requires a non-empty id');
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof provider[method] !== 'function') {
      throw new TypeError(`Integration provider '${provider.id}' must implement ${method}()`);
    }
  }

  return provider;
}

class IntegrationProviderRegistry {
  constructor(providers = []) {
    this.providers = new Map();
    providers.forEach(provider => this.register(provider));
  }

  register(provider) {
    const validated = assertIntegrationProvider(provider);
    if (this.providers.has(validated.id)) {
      throw new Error(`Integration provider '${validated.id}' is already registered`);
    }
    this.providers.set(validated.id, validated);
    return validated;
  }

  get(providerId) {
    return this.providers.get(providerId) || null;
  }

  resolveForAction(actionName, preferredProviderId = null) {
    if (preferredProviderId) {
      const preferred = this.get(preferredProviderId);
      if (preferred?.supportsAction(actionName)) return preferred;
    }

    return [...this.providers.values()].find(provider => provider.supportsAction(actionName)) || null;
  }
}

module.exports = {
  assertIntegrationProvider,
  IntegrationProviderRegistry,
};
