const assert = require('assert');
const { schedulingValidation, parsePreferredStart } = require('../services/automaticInterviewSchedulingService');

const validAssignment = {
  candidate_name: 'Asha',
  candidate_email: 'asha@example.test',
  interviewer_email: 'mentor@example.test',
  status: 'Ready to schedule',
  preferred_start: '2030-01-07T09:00:00Z',
};

assert.deepStrictEqual(schedulingValidation(validAssignment), []);
assert.match(schedulingValidation({ ...validAssignment, preferred_start: '' }).join(' '), /Preferred start is missing/);
assert.match(schedulingValidation({ ...validAssignment, preferred_start: 'not-a-date' }).join(' '), /Preferred start is invalid/);
assert.match(schedulingValidation({ ...validAssignment, status: 'Waiting' }).join(' '), /not ready/);
assert.strictEqual(parsePreferredStart('2030-01-07 09:00', 'Asia/Kolkata').toISOString(), '2030-01-07T03:30:00.000Z');

console.log('Automatic interview scheduling validation tests passed');
