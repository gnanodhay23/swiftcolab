/**
 * Temporal Client
 *
 * Used to start workflows, send signals, and query workflow state.
 */

const { Client, Connection } = require('@temporalio/client');
const { v4: uuidv4 } = require('uuid');
const { TASK_QUEUE } = require('./worker');

let client = null;
let connection = null;

/**
 * Initialize Temporal client connection
 */
async function initializeClient(temporalAddress) {
  if (client) {
    console.log('[Temporal Client] Client already initialized');
    return client;
  }

  const address = temporalAddress || process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233';

  console.log(`[Temporal Client] Connecting to Temporal at ${address}`);

  try {
    connection = await Connection.connect({
      address,
    });

    client = new Client({
      connection,
      namespace: 'default',
    });

    console.log('[Temporal Client] Connected successfully');
    return client;

  } catch (error) {
    console.error('[Temporal Client] Failed to connect:', error.message);
    throw error;
  }
}

/**
 * Start a new orchestration workflow
 *
 * NEW: Accepts executionPlan and skipValidation for pre-validated requests
 */
async function startOrchestrationWorkflow({
  message,
  userId,
  entityId,
  selectedToolkits,
  availableTools,
  followupContext,
  enrichedContext, // Context-aware intent detection and default params
  executionPlan,   // NEW: Pre-validated execution plan from PreValidationLayer
  skipValidation,  // NEW: Skip validation flag
}) {
  if (!client) {
    throw new Error('Temporal client not initialized');
  }

  const workflowId = `orchestration-${userId || 'anon'}-${uuidv4().slice(0, 8)}`;

  console.log(`[Temporal Client] Starting workflow ${workflowId}`);

  // Normalize executionPlan: support both 'steps' (from ExecutorV2) and 'tasks' (legacy/workflow)
  let normalizedPlan = executionPlan;
  if (executionPlan && !executionPlan.tasks && executionPlan.steps && executionPlan.steps.length > 0) {
    normalizedPlan = {
      ...executionPlan,
      tasks: executionPlan.steps, // Map 'steps' to 'tasks' for workflow compatibility
    };
    console.log(`[Temporal Client] Normalized plan: mapped ${executionPlan.steps.length} steps to tasks`);
  } else if (executionPlan && !executionPlan.tasks && (!executionPlan.steps || executionPlan.steps.length === 0)) {
    console.warn(`[Temporal Client] WARNING: executionPlan has no steps or tasks`);
  }

  if (skipValidation && normalizedPlan) {
    console.log(`[Temporal Client] Pre-validated plan with ${normalizedPlan.tasks?.length || 0} tasks`);
  }

  try {
    const handle = await client.workflow.start('orchestrationWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [{
        message,
        userId,
        entityId,
        selectedToolkits,
        availableTools,
        followupContext,
        enrichedContext, // Pass context-aware info to workflow
        executionPlan: normalizedPlan,   // Pass normalized plan (with tasks)
        skipValidation,  // Pass skip flag
      }],
      // Workflow options
      workflowExecutionTimeout: '5 minutes',
      workflowRunTimeout: '2 minutes',
    });

    console.log(`[Temporal Client] Workflow ${workflowId} started`);

    // Wait for result (with timeout)
    const result = await handle.result();

    console.log(`[Temporal Client] Workflow ${workflowId} completed`);

    return {
      ...result,
      workflowId,
      requestId: workflowId,
    };

  } catch (error) {
    console.error(`[Temporal Client] Workflow error:`, error.message);

    // Handle workflow failures gracefully
    return {
      type: 'error',
      message: `Workflow failed: ${error.message}`,
      workflowId,
      error: error.message,
    };
  }
}

/**
 * Start a daily planner workflow
 */
async function startDailyPlannerWorkflow({ userId, entityId, selectedToolkits }) {
  if (!client) {
    throw new Error('Temporal client not initialized');
  }

  const workflowId = `daily-plan-${userId || 'anon'}-${uuidv4().slice(0, 8)}`;

  console.log(`[Temporal Client] Starting daily planner workflow ${workflowId}`);

  try {
    const handle = await client.workflow.start('dailyPlannerWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [{
        userId,
        entityId,
        selectedToolkits,
      }],
      workflowExecutionTimeout: '2 minutes',
      workflowRunTimeout: '2 minutes',
    });

    const result = await handle.result();

    return {
      ...result,
      workflowId,
    };
  } catch (error) {
    console.error('[Temporal Client] Daily planner workflow error:', error.message);
    return {
      type: 'error',
      message: `Daily planner workflow failed: ${error.message}`,
      workflowId,
      error: error.message,
    };
  }
}

/**
 * Send a signal to a running workflow (e.g., followup response)
 */
async function sendFollowupSignal(workflowId, response) {
  if (!client) {
    throw new Error('Temporal client not initialized');
  }

  console.log(`[Temporal Client] Sending followup signal to ${workflowId}`);

  const handle = client.workflow.getHandle(workflowId);
  await handle.signal('provideFollowup', response);

  console.log(`[Temporal Client] Signal sent to ${workflowId}`);
}

/**
 * Query workflow state
 */
async function queryWorkflowState(workflowId) {
  if (!client) {
    throw new Error('Temporal client not initialized');
  }

  console.log(`[Temporal Client] Querying state of ${workflowId}`);

  const handle = client.workflow.getHandle(workflowId);
  const state = await handle.query('getState');

  return state;
}

/**
 * Query workflow results
 */
async function queryWorkflowResults(workflowId) {
  if (!client) {
    throw new Error('Temporal client not initialized');
  }

  console.log(`[Temporal Client] Querying results of ${workflowId}`);

  const handle = client.workflow.getHandle(workflowId);
  const results = await handle.query('getResults');

  return results;
}

/**
 * Cancel a workflow
 */
async function cancelWorkflow(workflowId) {
  if (!client) {
    throw new Error('Temporal client not initialized');
  }

  console.log(`[Temporal Client] Cancelling workflow ${workflowId}`);

  const handle = client.workflow.getHandle(workflowId);
  await handle.signal('cancelWorkflow');

  console.log(`[Temporal Client] Cancel signal sent to ${workflowId}`);
}

/**
 * Close the client connection
 */
async function closeClient() {
  if (connection) {
    await connection.close();
    connection = null;
    client = null;
    console.log('[Temporal Client] Connection closed');
  }
}

/**
 * Check if client is connected
 */
function isConnected() {
  return client !== null;
}

module.exports = {
  initializeClient,
  startOrchestrationWorkflow,
  startDailyPlannerWorkflow,
  sendFollowupSignal,
  queryWorkflowState,
  queryWorkflowResults,
  cancelWorkflow,
  closeClient,
  isConnected,
};
