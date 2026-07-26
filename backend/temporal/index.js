/**
 * Temporal Module Index
 *
 * Exports all Temporal components for use in the application.
 */

const { startWorker, stopWorker, isWorkerRunning, TASK_QUEUE } = require('./worker');
const {
  initializeClient,
  startOrchestrationWorkflow,
  startDailyPlannerWorkflow,
  sendFollowupSignal,
  queryWorkflowState,
  queryWorkflowResults,
  cancelWorkflow,
  closeClient,
  isConnected,
} = require('./client');

module.exports = {
  // Worker
  startWorker,
  stopWorker,
  isWorkerRunning,
  TASK_QUEUE,

  // Client
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
