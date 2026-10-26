const cron = require('node-cron');
const { runAllEnabledAutomations } = require('../services/automaticInterviewSchedulingService');

let task = null;

function startAutomaticInterviewSchedulingJob() {
  if (task) return task;
  task = cron.schedule('*/5 * * * *', async () => {
    try {
      console.log('[AutomaticScheduling] Checking enabled organizations');
      await runAllEnabledAutomations();
    } catch (error) {
      console.error('[AutomaticScheduling] Scheduled job failed', error.message);
    }
  });
  console.log('[AutomaticScheduling] Job started (every 5 minutes)');
  return task;
}

function stopAutomaticInterviewSchedulingJob() {
  if (task) task.stop();
  task = null;
}

module.exports = { startAutomaticInterviewSchedulingJob, stopAutomaticInterviewSchedulingJob };
