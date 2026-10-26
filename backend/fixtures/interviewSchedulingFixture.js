function fixtureAssignments() {
  return [
    {
      id: 'assignment-ava-chen',
      candidate_name: 'Ava Chen',
      candidate_email: 'ava.chen@example.test',
      interviewer_name: 'Ravi Kumar',
      interviewer_email: 'ravi.kumar@example.test',
      duration_minutes: 60,
      status: 'Ready to schedule',
    },
    {
      id: 'assignment-incomplete',
      candidate_name: 'Missing Email Example',
      candidate_email: '',
      interviewer_name: 'Ravi Kumar',
      interviewer_email: 'ravi.kumar@example.test',
      duration_minutes: 60,
      status: 'Ready to schedule',
    },
    {
      id: 'assignment-waiting',
      candidate_name: 'Waiting Candidate',
      candidate_email: 'waiting@example.test',
      interviewer_name: 'Ravi Kumar',
      interviewer_email: 'ravi.kumar@example.test',
      duration_minutes: 60,
      status: 'Waiting for candidate',
    },
  ];
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

async function listAssignments() {
  return fixtureAssignments();
}

async function getBusyIntervals({ rangeStart }) {
  const start = new Date(rangeStart);
  return [
    { start: addMinutes(start, 180), end: addMinutes(start, 240) },
    { start: addMinutes(start, 480), end: addMinutes(start, 570) },
  ];
}

module.exports = { listAssignments, getBusyIntervals };
