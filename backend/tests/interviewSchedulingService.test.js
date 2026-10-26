const assert = require('assert');
const {
  validateConfiguration,
  validateAssignment,
  findAvailableSlots,
} = require('../services/interviewSchedulingService');

function run() {
  const config = validateConfiguration({ timezone: 'UTC', workday_start: 9, workday_end: 18, minimum_notice_hours: 0, search_days: 2, buffer_minutes: 0 });
  assert.strictEqual(config.default_duration_minutes, 60);
  assert.throws(() => validateConfiguration({ timezone: 'not-a-timezone' }), /Invalid timezone/);
  assert.deepStrictEqual(validateAssignment({ candidate_name: 'A', candidate_email: 'a@example.test', interviewer_email: 'i@example.test', status: 'Ready to schedule' }), []);
  assert.match(validateAssignment({ status: 'Waiting' }).join(' '), /not ready/);
  const result = findAvailableSlots({
    now: new Date('2030-01-07T08:00:00.000Z'),
    config,
    busyIntervals: [{ start: '2030-01-07T09:00:00.000Z', end: '2030-01-07T10:00:00.000Z' }],
    durationMinutes: 60,
  });
  assert.strictEqual(result.slots.length, 3);
  assert(result.slots.every(slot => new Date(slot.start) >= new Date('2030-01-07T10:00:00.000Z')));
  console.log('Interview scheduling service tests passed');
}

try { run(); } catch (error) { console.error(error); process.exitCode = 1; }
