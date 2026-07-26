/**
 * Temporal Worker
 *
 * The worker hosts workflows and activities, executing them when requested.
 * It connects to the Temporal server and polls for work.
 */

const { Worker, NativeConnection } = require('@temporalio/worker');
const path = require('path');

// Import only the activities that are actually exported from composioActivities.js
const {
  initializeActivities,
  executeComposioAction,
  formatResults,
  storeActionParams,
  generateEmailBodyFromData,
  summarizeDataWithAI,
} = require('./activities/composioActivities');

// Task queue name
const TASK_QUEUE = 'orchestration-tasks';

let worker = null;
let isRunning = false;

/**
 * Create and start the Temporal worker
 */
async function startWorker({ composio, callGemini, query, temporalAddress }) {
  if (isRunning) {
    console.log('[Temporal Worker] Worker already running');
    return;
  }

  // Initialize activities with dependencies
  initializeActivities({ composio, callGemini, query });

  const address = temporalAddress || process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233';

  console.log(`[Temporal Worker] Connecting to Temporal at ${address}`);

  try {
    // Create connection to Temporal server
    const connection = await NativeConnection.connect({
      address,
    });

    // Create worker
    worker = await Worker.create({
      connection,
      namespace: 'default',
      taskQueue: TASK_QUEUE,
      workflowsPath: path.join(__dirname, 'workflows'),
      activities: {
        // Core execution activities
        executeComposioAction,
        formatResults,
        storeActionParams,
        generateEmailBodyFromData,
        summarizeDataWithAI,
      },
      // Worker options for reliability
      maxConcurrentWorkflowTaskExecutions: 10,
      maxConcurrentActivityTaskExecutions: 20,
    });

    console.log('[Temporal Worker] Worker created successfully');

    // Start the worker
    isRunning = true;
    worker.run().then(() => {
      console.log('[Temporal Worker] Worker stopped');
      isRunning = false;
    }).catch(err => {
      console.error('[Temporal Worker] Worker error:', err);
      isRunning = false;
    });

    console.log('[Temporal Worker] Worker started and polling for tasks');

    return worker;

  } catch (error) {
    console.error('[Temporal Worker] Failed to start worker:', error.message);

    // If Temporal server isn't available, log a warning but don't crash
    if (error.message.includes('UNAVAILABLE') || error.message.includes('connect')) {
      console.warn('[Temporal Worker] Temporal server not available. Running without Temporal.');
      console.warn('[Temporal Worker] To use Temporal, start the server with: temporal server start-dev');
    }

    throw error;
  }
}

/**
 * Stop the worker gracefully
 */
async function stopWorker() {
  if (worker) {
    console.log('[Temporal Worker] Stopping worker...');
    await worker.shutdown();
    worker = null;
    isRunning = false;
    console.log('[Temporal Worker] Worker stopped');
  }
}

/**
 * Check if worker is running
 */
function isWorkerRunning() {
  return isRunning;
}

/**
 * Get task queue name
 */
function getTaskQueue() {
  return TASK_QUEUE;
}

module.exports = {
  startWorker,
  stopWorker,
  isWorkerRunning,
  getTaskQueue,
  TASK_QUEUE,
};
