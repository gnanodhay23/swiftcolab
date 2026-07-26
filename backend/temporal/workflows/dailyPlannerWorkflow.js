/**
 * Temporal Daily Planner Workflow
 *
 * Uses ProactiveEngine snapshot logic to generate a daily plan
 * while benefiting from Temporal durability and retries.
 */

const { proxyActivities } = require('@temporalio/workflow');

const {
  generateDailyPlanActivity,
} = proxyActivities({
  startToCloseTimeout: '120 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: 3,
    maximumInterval: '30 seconds',
  },
});

async function dailyPlannerWorkflow({ userId, entityId, selectedToolkits }) {
  const plan = await generateDailyPlanActivity({ userId, entityId, selectedToolkits });
  return {
    type: 'daily_plan',
    ...plan,
  };
}

module.exports = { dailyPlannerWorkflow };
