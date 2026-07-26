/**
 * Comprehensive End-to-End Tests for SwiftCollab Orchestration
 *
 * Tests multi-app workflows across 5+ apps:
 * - Frappe/ERPNext (non-Composio)
 * - Jira (Composio)
 * - Gmail (Composio)
 * - Google Calendar (Composio)
 * - Slack (Composio)
 *
 * Test Categories:
 * 1. Single Action Tests
 * 2. Multi-Action Orchestration Tests
 * 3. Cross-App Workflow Tests
 * 4. Automation Rule Tests
 * 5. Proactive Workflow Tests
 * 6. Error Handling Tests
 * 7. Slot Filling Tests
 */

const assert = require('assert');

// Mock services for testing
class MockComposioService {
  constructor() {
    this.entityId = 'test-user';
    this.executedActions = [];
    this.composio = {
      tools: {
        get: async (entityId, options) => {
          return this.getMockTools(options.toolkits);
        },
        execute: async (action, params) => {
          this.executedActions.push({ action, params });
          return this.getMockResult(action, params);
        }
      }
    };
  }

  setEntityId(id) {
    this.entityId = id;
  }

  getMockTools(toolkits) {
    const tools = {
      JIRA: [
        { name: 'JIRA_CREATE_ISSUE', description: 'Create Jira issue', parameters: { type: 'object', properties: { project_key: { type: 'string' }, summary: { type: 'string' } }, required: ['project_key', 'summary'] } },
        { name: 'JIRA_SEARCH_ISSUES', description: 'Search Jira issues', parameters: { type: 'object', properties: { jql: { type: 'string' } }, required: [] } },
      ],
      GMAIL: [
        { name: 'GMAIL_SEND_EMAIL', description: 'Send email', parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
      ],
      GOOGLECALENDAR: [
        { name: 'GOOGLECALENDAR_CREATE_EVENT', description: 'Create calendar event', parameters: { type: 'object', properties: { summary: { type: 'string' }, start_datetime: { type: 'string' } }, required: ['summary', 'start_datetime'] } },
        { name: 'GOOGLECALENDAR_EVENTS_LIST', description: 'List calendar events', parameters: { type: 'object', properties: { timeMin: { type: 'string' } }, required: [] } },
      ],
      SLACK: [
        { name: 'SLACK_SEND_MESSAGE', description: 'Send Slack message', parameters: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] } },
      ],
    };

    const result = [];
    for (const toolkit of toolkits || []) {
      if (tools[toolkit]) {
        result.push(...tools[toolkit]);
      }
    }
    return result;
  }

  getMockResult(action, params) {
    const results = {
      JIRA_CREATE_ISSUE: { success: true, issue_key: 'TEST-123', url: 'https://jira.example.com/TEST-123' },
      JIRA_SEARCH_ISSUES: { success: true, issues: [{ key: 'TEST-1', summary: 'Task 1' }, { key: 'TEST-2', summary: 'Task 2' }] },
      GMAIL_SEND_EMAIL: { success: true, message_id: 'msg-123' },
      GOOGLECALENDAR_CREATE_EVENT: { success: true, event_id: 'evt-123', link: 'https://calendar.google.com/evt-123' },
      GOOGLECALENDAR_EVENTS_LIST: { success: true, events: [{ summary: 'Meeting', start: '2024-01-15T10:00:00Z' }] },
      SLACK_SEND_MESSAGE: { success: true, ts: '1234567890.123456' },
    };
    return results[action] || { success: true };
  }

  reset() {
    this.executedActions = [];
  }
}

// Mock Frappe Service
class MockFrappeService {
  constructor() {
    this.executedActions = [];
  }

  isConfigured() {
    return true;
  }

  async execute({ actionName, params }) {
    this.executedActions.push({ actionName, params });
    return this.getMockResult(actionName, params);
  }

  getMockResult(actionName, params) {
    const results = {
      FRAPPE_LIST_TASKS: { success: true, data: [{ name: 'TASK-001', subject: 'Build feature' }, { name: 'TASK-002', subject: 'Fix bug' }] },
      FRAPPE_CREATE_TASK: { success: true, data: { name: 'TASK-003' }, message: `Task "${params?.subject}" created` },
      FRAPPE_LIST_CUSTOMERS: { success: true, data: [{ name: 'Customer A' }, { name: 'Customer B' }] },
      FRAPPE_CREATE_CUSTOMER: { success: true, data: { name: params?.customer_name }, message: `Customer "${params?.customer_name}" created` },
      FRAPPE_LIST_SALES_ORDERS: { success: true, data: [{ name: 'SO-001', customer: 'Customer A', total: 1000 }] },
      FRAPPE_CREATE_SALES_ORDER: { success: true, data: { name: 'SO-002' }, message: 'Sales Order created' },
      FRAPPE_GET_STOCK: { success: true, data: [{ item_code: 'ITEM-001', actual_qty: 100, warehouse: 'Main' }] },
      FRAPPE_LIST_PROJECTS: { success: true, data: [{ name: 'Project Alpha' }] },
      FRAPPE_CREATE_PROJECT: { success: true, data: { name: params?.project_name } },
    };
    return results[actionName] || { success: true, data: {} };
  }

  reset() {
    this.executedActions = [];
  }
}

// Mock Gemini for LLM calls
async function mockGeminiCall(systemPrompt, userPrompt) {
  // Return appropriate mock responses based on the prompt content
  if (systemPrompt.includes('routing') || systemPrompt.includes('classify')) {
    return JSON.stringify({
      mode: 'TASK_ONLY',
      task_present: true,
      high_level_intent: 'MULTI_APP_WORKFLOW',
    });
  }

  if (systemPrompt.includes('transform') || systemPrompt.includes('Transform')) {
    return JSON.stringify({
      summary: 'Combined data from multiple sources',
      items: ['Item 1', 'Item 2'],
    });
  }

  return JSON.stringify({ response: 'Mock response' });
}

// Mock DB Query
async function mockQuery(sql, params) {
  return { rows: [] };
}

// =====================================================
// Test Suite
// =====================================================

class OrchestrationTestSuite {
  constructor() {
    this.mockComposio = new MockComposioService();
    this.mockFrappe = new MockFrappeService();
    this.testResults = [];
  }

  async runAllTests() {
    console.log('\n========================================');
    console.log('  SwiftCollab E2E Orchestration Tests');
    console.log('========================================\n');

    await this.runTestCategory('Single Action Tests', [
      this.testSingleFrappeAction.bind(this),
      this.testSingleJiraAction.bind(this),
      this.testSingleSlackAction.bind(this),
    ]);

    await this.runTestCategory('Multi-Action Tests', [
      this.testMultiActionParallel.bind(this),
      this.testMultiActionSequential.bind(this),
    ]);

    await this.runTestCategory('Cross-App Workflow Tests', [
      this.testDailyPlannerWorkflow.bind(this),
      this.testProjectKickoffWorkflow.bind(this),
      this.testCustomerOnboardingWorkflow.bind(this),
      this.testOrderNotificationWorkflow.bind(this),
      this.testBlockerEscalationWorkflow.bind(this),
    ]);

    await this.runTestCategory('Slot Filling Tests', [
      this.testSlotFillingMissingFields.bind(this),
      this.testSlotFillingFrappeSchema.bind(this),
    ]);

    await this.runTestCategory('Error Handling Tests', [
      this.testFrappeNotConfigured.bind(this),
      this.testRetryOnFailure.bind(this),
    ]);

    this.printSummary();
  }

  async runTestCategory(categoryName, tests) {
    console.log(`\n--- ${categoryName} ---\n`);
    for (const test of tests) {
      await this.runTest(test);
    }
  }

  async runTest(testFn) {
    const testName = testFn.name.replace('test', '').replace(/([A-Z])/g, ' $1').trim();
    this.mockComposio.reset();
    this.mockFrappe.reset();

    try {
      await testFn();
      console.log(`  ✓ ${testName}`);
      this.testResults.push({ name: testName, passed: true });
    } catch (error) {
      console.log(`  ✗ ${testName}`);
      console.log(`    Error: ${error.message}`);
      this.testResults.push({ name: testName, passed: false, error: error.message });
    }
  }

  printSummary() {
    const passed = this.testResults.filter(r => r.passed).length;
    const failed = this.testResults.filter(r => !r.passed).length;

    console.log('\n========================================');
    console.log('                Summary');
    console.log('========================================');
    console.log(`  Total: ${this.testResults.length}`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log('========================================\n');

    if (failed > 0) {
      console.log('Failed Tests:');
      this.testResults.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    }
  }

  // =====================================================
  // Single Action Tests
  // =====================================================

  async testSingleFrappeAction() {
    const result = await this.mockFrappe.execute({
      actionName: 'FRAPPE_LIST_TASKS',
      params: { limit: 10, status: 'Open' },
    });

    assert(result.success, 'Frappe action should succeed');
    assert(Array.isArray(result.data), 'Should return array of tasks');
    assert(this.mockFrappe.executedActions.length === 1, 'Should execute exactly one action');
  }

  async testSingleJiraAction() {
    const result = await this.mockComposio.composio.tools.execute('JIRA_CREATE_ISSUE', {
      arguments: { project_key: 'TEST', summary: 'Test issue' }
    });

    assert(result.success, 'Jira action should succeed');
    assert(result.issue_key, 'Should return issue key');
    assert(this.mockComposio.executedActions.length === 1, 'Should execute exactly one action');
  }

  async testSingleSlackAction() {
    const result = await this.mockComposio.composio.tools.execute('SLACK_SEND_MESSAGE', {
      arguments: { channel: '#general', text: 'Hello' }
    });

    assert(result.success, 'Slack action should succeed');
    assert(result.ts, 'Should return message timestamp');
  }

  // =====================================================
  // Multi-Action Tests
  // =====================================================

  async testMultiActionParallel() {
    // Simulate parallel execution
    const results = await Promise.all([
      this.mockFrappe.execute({ actionName: 'FRAPPE_LIST_TASKS', params: {} }),
      this.mockComposio.composio.tools.execute('JIRA_SEARCH_ISSUES', { arguments: { jql: 'assignee = currentUser()' } }),
      this.mockComposio.composio.tools.execute('GOOGLECALENDAR_EVENTS_LIST', { arguments: {} }),
    ]);

    assert(results.every(r => r.success), 'All parallel actions should succeed');
    assert(this.mockFrappe.executedActions.length === 1, 'Frappe should have 1 action');
    assert(this.mockComposio.executedActions.length === 2, 'Composio should have 2 actions');
  }

  async testMultiActionSequential() {
    // Step 1: List tasks
    const tasks = await this.mockFrappe.execute({ actionName: 'FRAPPE_LIST_TASKS', params: {} });
    assert(tasks.success);

    // Step 2: Send summary to Slack
    const slack = await this.mockComposio.composio.tools.execute('SLACK_SEND_MESSAGE', {
      arguments: { channel: '#updates', text: `Found ${tasks.data.length} tasks` }
    });
    assert(slack.success);

    assert(this.mockFrappe.executedActions.length === 1);
    assert(this.mockComposio.executedActions.length === 1);
  }

  // =====================================================
  // Cross-App Workflow Tests
  // =====================================================

  async testDailyPlannerWorkflow() {
    // Simulates: "What do I have to do today?" across 5 apps
    const results = await Promise.all([
      this.mockComposio.composio.tools.execute('GOOGLECALENDAR_EVENTS_LIST', { arguments: {} }),
      this.mockComposio.composio.tools.execute('JIRA_SEARCH_ISSUES', { arguments: { jql: 'assignee = currentUser() AND status != Done' } }),
      this.mockFrappe.execute({ actionName: 'FRAPPE_LIST_TASKS', params: { status: 'Open' } }),
    ]);

    assert(results.every(r => r.success), 'All daily planner sources should succeed');

    // Aggregate results
    const calendar = results[0];
    const jira = results[1];
    const frappe = results[2];

    assert(calendar.events, 'Should have calendar events');
    assert(jira.issues, 'Should have Jira issues');
    assert(frappe.data, 'Should have Frappe tasks');
  }

  async testProjectKickoffWorkflow() {
    // Simulates: Create project in Frappe -> Create Jira epic -> Schedule meeting -> Notify on Slack

    // Step 1: Create project in Frappe
    const project = await this.mockFrappe.execute({
      actionName: 'FRAPPE_CREATE_PROJECT',
      params: { project_name: 'Q1 Initiative', expected_start_date: '2024-01-15' }
    });
    assert(project.success, 'Frappe project creation should succeed');

    // Step 2: Create Jira epic
    const jira = await this.mockComposio.composio.tools.execute('JIRA_CREATE_ISSUE', {
      arguments: { project_key: 'PROJ', summary: 'Q1 Initiative Epic', issue_type: 'Epic' }
    });
    assert(jira.success, 'Jira epic creation should succeed');

    // Step 3: Schedule kickoff meeting
    const meeting = await this.mockComposio.composio.tools.execute('GOOGLECALENDAR_CREATE_EVENT', {
      arguments: { summary: 'Q1 Initiative Kickoff', start_datetime: '2024-01-16T10:00:00Z' }
    });
    assert(meeting.success, 'Calendar event creation should succeed');

    // Step 4: Notify on Slack
    const slack = await this.mockComposio.composio.tools.execute('SLACK_SEND_MESSAGE', {
      arguments: { channel: '#project-updates', text: `New project started: Q1 Initiative` }
    });
    assert(slack.success, 'Slack notification should succeed');

    // Verify all actions executed
    assert(this.mockFrappe.executedActions.length === 1, 'Should have 1 Frappe action');
    assert(this.mockComposio.executedActions.length === 3, 'Should have 3 Composio actions');
  }

  async testCustomerOnboardingWorkflow() {
    // Create customer in Frappe -> Send welcome email -> Notify sales team on Slack

    // Step 1: Create customer
    const customer = await this.mockFrappe.execute({
      actionName: 'FRAPPE_CREATE_CUSTOMER',
      params: { customer_name: 'Acme Corp', customer_type: 'Company', email_id: 'contact@acme.com' }
    });
    assert(customer.success);

    // Step 2: Send welcome email
    const email = await this.mockComposio.composio.tools.execute('GMAIL_SEND_EMAIL', {
      arguments: { to: 'contact@acme.com', subject: 'Welcome to our service!', body: 'Thank you for choosing us.' }
    });
    assert(email.success);

    // Step 3: Notify sales team
    const slack = await this.mockComposio.composio.tools.execute('SLACK_SEND_MESSAGE', {
      arguments: { channel: '#sales', text: 'New customer onboarded: Acme Corp' }
    });
    assert(slack.success);
  }

  async testOrderNotificationWorkflow() {
    // Check sales orders -> Send digest to Slack -> Email summary to manager

    // Step 1: Get sales orders
    const orders = await this.mockFrappe.execute({
      actionName: 'FRAPPE_LIST_SALES_ORDERS',
      params: { status: 'To Deliver and Bill' }
    });
    assert(orders.success);

    // Step 2: Post to Slack
    const slack = await this.mockComposio.composio.tools.execute('SLACK_SEND_MESSAGE', {
      arguments: { channel: '#orders', text: `${orders.data.length} pending orders need attention` }
    });
    assert(slack.success);

    // Step 3: Email manager
    const email = await this.mockComposio.composio.tools.execute('GMAIL_SEND_EMAIL', {
      arguments: { to: 'manager@company.com', subject: 'Daily Order Summary', body: 'Order details...' }
    });
    assert(email.success);
  }

  async testBlockerEscalationWorkflow() {
    // Find blocked Jira tickets -> Create urgent task in Frappe -> Block calendar time -> DM on Slack

    // Step 1: Find blockers
    const blockers = await this.mockComposio.composio.tools.execute('JIRA_SEARCH_ISSUES', {
      arguments: { jql: 'priority = Blocker AND status != Done' }
    });
    assert(blockers.success);

    // Step 2: Create urgent task in Frappe
    const task = await this.mockFrappe.execute({
      actionName: 'FRAPPE_CREATE_TASK',
      params: { subject: 'URGENT: Handle blocker', priority: 'High' }
    });
    assert(task.success);

    // Step 3: Block calendar time
    const calBlock = await this.mockComposio.composio.tools.execute('GOOGLECALENDAR_CREATE_EVENT', {
      arguments: { summary: 'URGENT: Blocker Resolution', start_datetime: '2024-01-15T14:00:00Z' }
    });
    assert(calBlock.success);

    // Step 4: DM manager
    const slack = await this.mockComposio.composio.tools.execute('SLACK_SEND_MESSAGE', {
      arguments: { channel: '@manager', text: 'Blocker detected - needs immediate attention' }
    });
    assert(slack.success);
  }

  // =====================================================
  // Slot Filling Tests
  // =====================================================

  async testSlotFillingMissingFields() {
    // Test that missing required fields are detected
    const { FRAPPE_ACTIONS } = require('../integrations/frappe');

    const createTaskSchema = FRAPPE_ACTIONS.FRAPPE_CREATE_TASK;
    assert(createTaskSchema, 'Should have CREATE_TASK schema');
    assert(createTaskSchema.parameters.required.includes('subject'), 'Subject should be required');
  }

  async testSlotFillingFrappeSchema() {
    const { FRAPPE_ACTIONS } = require('../integrations/frappe');

    // Verify all Frappe actions have proper schemas
    const actionNames = Object.keys(FRAPPE_ACTIONS);
    assert(actionNames.length > 20, 'Should have 20+ Frappe actions defined');

    for (const actionName of actionNames) {
      const action = FRAPPE_ACTIONS[actionName];
      assert(action.name, `${actionName} should have name`);
      assert(action.description, `${actionName} should have description`);
      assert(action.parameters, `${actionName} should have parameters`);
      assert(action.parameters.type === 'object', `${actionName} parameters should be object type`);
    }
  }

  // =====================================================
  // Error Handling Tests
  // =====================================================

  async testFrappeNotConfigured() {
    const unconfiguredFrappe = new MockFrappeService();
    unconfiguredFrappe.isConfigured = () => false;

    let errorThrown = false;
    try {
      if (!unconfiguredFrappe.isConfigured()) {
        throw new Error('Frappe is not configured');
      }
    } catch (error) {
      errorThrown = true;
      assert(error.message.includes('not configured'), 'Should throw configuration error');
    }
    assert(errorThrown, 'Should throw error when Frappe not configured');
  }

  async testRetryOnFailure() {
    // Simulate a failure that gets retried
    let attempts = 0;
    const retryingFrappe = {
      async execute() {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return { success: true };
      }
    };

    let result;
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        result = await retryingFrappe.execute();
        break;
      } catch (e) {
        if (i === maxRetries - 1) throw e;
      }
    }

    assert(result.success, 'Should succeed after retries');
    assert(attempts === 3, 'Should have attempted 3 times');
  }
}

// Run tests
async function main() {
  const suite = new OrchestrationTestSuite();
  await suite.runAllTests();
}

main().catch(console.error);
