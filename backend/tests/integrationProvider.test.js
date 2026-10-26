const assert = require('assert');
const { IntegrationProviderRegistry } = require('../integrations/IntegrationProvider');
const { ComposioProvider } = require('../integrations/ComposioProvider');

const calls = [];
const composioService = {
  async initiateConnection(...args) { calls.push(['connect', ...args]); return { redirectUrl: 'https://example.test' }; },
  async listConnectedAccounts(...args) { calls.push(['status', ...args]); return { items: [] }; },
  async executeAction(...args) { calls.push(['execute', ...args]); return { success: true }; },
};

async function run() {
  const provider = new ComposioProvider(composioService);
  const registry = new IntegrationProviderRegistry([provider]);

  assert.strictEqual(registry.resolveForAction('GMAIL_SEND_EMAIL'), provider);
  assert.strictEqual(registry.resolveForAction('GMAIL_SEND_EMAIL', 'composio'), provider);
  assert.strictEqual(registry.resolveForAction('GMAIL_SEND_EMAIL', 'missing'), provider);

  await provider.executeAction({ actionName: 'GMAIL_SEND_EMAIL', params: { body: 'test' }, entityId: 'user_1' });
  assert.deepStrictEqual(calls[0], ['execute', 'GMAIL_SEND_EMAIL', { body: 'test' }, 'user_1']);

  console.log('Integration provider contract tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
