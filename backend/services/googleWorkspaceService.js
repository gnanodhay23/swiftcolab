const crypto = require('crypto');
const { google } = require('googleapis');
const { query } = require('../db');
const { encrypt, decrypt } = require('./credentialEncryptionService');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const base64url = buffer => buffer.toString('base64url');

function oauthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) throw new Error('Google OAuth is not configured');
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}

async function startConnection({ organizationId, userId }) {
  const state = base64url(crypto.randomBytes(32));
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  await query(
    `INSERT INTO oauth_authorization_states (state_hash, organization_id, requested_by_user_id, provider, encrypted_code_verifier, expires_at)
     VALUES ($1, $2, $3, 'google_workspace', $4, NOW() + INTERVAL '10 minutes')`,
    [hash(state), organizationId, userId, encrypt(verifier)]
  );
  const url = oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' });
  return { authorizationUrl: url };
}

async function completeConnection({ state, code }) {
  const lookup = await query(
    `SELECT * FROM oauth_authorization_states WHERE state_hash = $1 AND provider = 'google_workspace'
       AND consumed_at IS NULL AND expires_at > NOW()`,
    [hash(state || '')]
  );
  const record = lookup.rows[0];
  if (!record || !code) throw new Error('Google authorization has expired or is invalid');
  const client = oauthClient();
  const { tokens } = await client.getToken({ code, codeVerifier: decrypt(record.encrypted_code_verifier) });
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Disconnect the app in Google and connect again.');
  await query(
    `INSERT INTO organization_integrations (organization_id, provider, integration_key, connected_by_user_id, status, scopes, encrypted_credentials)
     VALUES ($1, 'google_workspace', 'default', $2, 'connected', $3, $4)
     ON CONFLICT (organization_id, provider, integration_key) DO UPDATE SET connected_by_user_id = EXCLUDED.connected_by_user_id,
       status = 'connected', scopes = EXCLUDED.scopes, encrypted_credentials = EXCLUDED.encrypted_credentials, disconnected_at = NULL, updated_at = NOW()`,
    [record.organization_id, record.requested_by_user_id, JSON.stringify(SCOPES), encrypt(tokens)]
  );
  await query('UPDATE oauth_authorization_states SET consumed_at = NOW() WHERE id = $1', [record.id]);
  return { organizationId: record.organization_id };
}

async function status(organizationId) {
  const result = await query(`SELECT status, scopes, connected_at FROM organization_integrations WHERE organization_id = $1 AND provider = 'google_workspace' AND integration_key = 'default'`, [organizationId]);
  const integration = result.rows[0] || { status: 'disconnected', scopes: [] };
  return { ...integration, needs_reconnect: integration.status === 'connected' && !SCOPES.every(scope => integration.scopes?.includes(scope)) };
}

async function authenticatedClient(organizationId) {
  const result = await query(`SELECT encrypted_credentials FROM organization_integrations WHERE organization_id = $1 AND provider = 'google_workspace' AND integration_key = 'default' AND status = 'connected'`, [organizationId]);
  if (!result.rows[0]) throw new Error('Google Workspace is not connected for this organization');
  const client = oauthClient();
  client.setCredentials(decrypt(result.rows[0].encrypted_credentials));
  return client;
}

async function disconnect(organizationId) {
  await query(`UPDATE organization_integrations SET status = 'disconnected', disconnected_at = NOW(), encrypted_credentials = '' WHERE organization_id = $1 AND provider = 'google_workspace' AND integration_key = 'default'`, [organizationId]);
}

function spreadsheetId(value) {
  const normalized = String(value || '').trim().replace(/&#x0*2f;|&#0*47;|&sol;/gi, '/');
  const match = normalized.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : normalized;
}

const COLUMN_ALIASES = {
  candidate_name: ['candidate name', 'student name', 'applicant name', 'name'],
  candidate_email: ['candidate email', 'student email', 'applicant email', 'email'],
  interviewer_name: ['interviewer name', 'mentor name', 'host name'],
  interviewer_email: ['interviewer email', 'mentor email', 'host email'],
  duration_minutes: ['duration minutes', 'duration', 'interview duration'],
  status: ['status', 'scheduling status'],
  purpose: ['purpose', 'topic', 'interview type', 'reason'],
  preferred_start: ['preferred start', 'start time', 'scheduled start', 'interview start'],
};

function parseSheetValues(values = []) {
  const [rawHeaders = [], ...rows] = values;
  const headers = rawHeaders.map(header => String(header || '').trim());
  const headerMap = new Map(headers.map((header, index) => [header.toLowerCase(), index]));
  const field = (row, fieldName) => {
    const index = COLUMN_ALIASES[fieldName].map(alias => headerMap.get(alias)).find(Number.isInteger);
    return index === undefined ? '' : String(row[index] || '').trim();
  };
  const assignments = rows.filter(row => row.some(value => String(value || '').trim())).map((row, index) => ({
    id: `google:${index + 2}`,
    candidate_name: field(row, 'candidate_name'),
    candidate_email: field(row, 'candidate_email'),
    interviewer_name: field(row, 'interviewer_name') || field(row, 'interviewer_email'),
    interviewer_email: field(row, 'interviewer_email'),
    duration_minutes: Number(field(row, 'duration_minutes')) || 60,
    status: field(row, 'status'),
    purpose: field(row, 'purpose'),
    preferred_start: field(row, 'preferred_start'),
  }));
  const required = ['candidate_name', 'candidate_email', 'interviewer_email', 'status'];
  const missingFields = required.filter(fieldName => !COLUMN_ALIASES[fieldName].some(alias => headerMap.has(alias)));
  const warnings = [];
  if (!headers.length) warnings.push('The selected Sheet range has no header row.');
  if (!rows.length) warnings.push('No data rows were found below the header row.');
  if (missingFields.length) warnings.push(`Scheduling needs columns for: ${missingFields.map(fieldName => fieldName.replace('_', ' ')).join(', ')}.`);
  const previewRows = rows.slice(0, 5).map(row => Object.fromEntries(headers.slice(0, 8).map((header, index) => [header, String(row[index] || '')])));
  return { headers: headers.slice(0, 20), previewRows, rowCount: assignments.length, assignments, warnings };
}

function toSheetReadError(error) {
  const message = String(error?.response?.data?.error?.message || error?.message || '');
  let publicMessage = 'SwiftCollab could not read this Google Sheet. Please try again.';
  if (/has not been used|is disabled|enable it/i.test(message)) publicMessage = 'Google Sheets API is not enabled for this Google Cloud project. Enable it, wait a few minutes, then retry.';
  else if (/permission|forbidden|not authorized/i.test(message)) publicMessage = 'SwiftCollab cannot access this Sheet. Share the Sheet with the Google account you connected, then retry.';
  else if (/not found|unable to parse range|range/i.test(message)) publicMessage = 'The Sheet or worksheet range was not found. Check the Sheet link and tab name (currently Sheet1).';
  const wrapped = new Error(publicMessage);
  wrapped.statusCode = error?.response?.status || 502;
  return wrapped;
}

async function readSheet({ organizationId, spreadsheet, range }) {
  const sheets = google.sheets({ version: 'v4', auth: await authenticatedClient(organizationId) });
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId(spreadsheet), range });
    return parseSheetValues(response.data.values || []);
  } catch (error) { throw toSheetReadError(error); }
}

async function readAssignments(options) {
  return (await readSheet(options)).assignments;
}

async function getBusyIntervals({ organizationId, rangeStart, rangeEnd, interviewerEmail, timezone }) {
  const calendar = google.calendar({ version: 'v3', auth: await authenticatedClient(organizationId) });
  const response = await calendar.freebusy.query({ requestBody: { timeMin: rangeStart, timeMax: rangeEnd, timeZone: timezone, items: [{ id: interviewerEmail }] } });
  return response.data.calendars?.[interviewerEmail]?.busy || [];
}

async function createInterviewEvent({ organizationId, executionId, assignment, start, end, timezone }) {
  const calendar = google.calendar({ version: 'v3', auth: await authenticatedClient(organizationId) });
  const response = await calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,
    sendUpdates: 'all',
    requestBody: {
      summary: `Mock interview: ${assignment.candidate_name}`,
      description: assignment.purpose || 'Interview scheduled by SwiftCollab',
      start: { dateTime: start, timeZone: timezone },
      end: { dateTime: end, timeZone: timezone },
      attendees: [assignment.candidate_email, assignment.interviewer_email].filter(Boolean).map(email => ({ email })),
      conferenceData: { createRequest: { requestId: `swiftcollab-${executionId}` } },
      extendedProperties: { private: { swiftcollab_execution_id: executionId } },
    },
  });
  return { eventId: response.data.id, meetingUrl: response.data.hangoutLink || response.data.conferenceData?.entryPoints?.find(entry => entry.entryPointType === 'video')?.uri || null };
}

async function updateInterviewEvent({ organizationId, eventId, assignment, start, end, timezone }) {
  const calendar = google.calendar({ version: 'v3', auth: await authenticatedClient(organizationId) });
  const response = await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
    requestBody: {
      summary: `Mock interview: ${assignment.candidate_name}`,
      description: assignment.purpose || 'Interview scheduled by SwiftCollab',
      start: { dateTime: start, timeZone: timezone },
      end: { dateTime: end, timeZone: timezone },
      attendees: [assignment.candidate_email, assignment.interviewer_email].filter(Boolean).map(email => ({ email })),
    },
  });
  return { meetingUrl: response.data.hangoutLink || response.data.conferenceData?.entryPoints?.find(entry => entry.entryPointType === 'video')?.uri || null };
}

module.exports = { SCOPES, startConnection, completeConnection, status, disconnect, readSheet, readAssignments, getBusyIntervals, createInterviewEvent, updateInterviewEvent, spreadsheetId, parseSheetValues };
