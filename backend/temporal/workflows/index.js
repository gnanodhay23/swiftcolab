/**
 * Workflow entrypoint for Temporal worker bundling.
 * Exports all workflows so the worker can bundle them.
 */

const { orchestrationWorkflow } = require('./orchestrationWorkflow');
const { dailyPlannerWorkflow } = require('./dailyPlannerWorkflow');

module.exports = {
  orchestrationWorkflow,
  dailyPlannerWorkflow,
};
