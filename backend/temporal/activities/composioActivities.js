/**
 * Temporal Activities for Composio Actions (Simplified - Option A)
 *
 * These are the ONLY activities needed for durable execution.
 * All parsing, routing, slot filling, and validation is done EXTERNALLY by:
 * - AssistantOrchestrator (entry point)
 * - ToolRouter (action selection)
 * - SlotFiller (parameter collection)
 * - PreflightChecker (validation & enrichment)
 *
 * Activities are the actual work units that execute external API calls.
 * They are retried automatically by Temporal on failure.
 */

const { ApplicationFailure } = require('@temporalio/activity');

// Date utilities for calendar actions
const { parseNaturalDateTime, addDurationToTime } = require('../../orchestration/core/DateUtils');
const CalendarUtils = require('../../orchestration/core/CalendarUtils');
const AssistantComposer = require('../../orchestration/AssistantComposer');
const { ActionResultFormatter } = require('../../orchestration/core/ActionResultFormatter');

// Context memory for storing action params (enables "same/previous/last" references)
const { ContextMemoryCache } = require('../../orchestration/core/ContextMemoryCache');

// Email body generation
const { generateEmailBody, validateEmailParams } = require('../../orchestration/core/EmailBodyGenerator');

// Frappe integration - for FRAPPE_* actions
const { executeFrappeAction: frappeExecute, FrappeService } = require('../../integrations/frappe');

// Injected dependencies
let composioClient = null;
let geminiClient = null;
let contextMemoryCache = null;
let actionResultFormatter = null;
let frappeService = null;

/**
 * Initialize activity dependencies
 * Called once when the Temporal worker starts
 */
function initializeActivities({ composio, callGemini, query }) {
  composioClient = composio;
  geminiClient = callGemini;

  // Initialize context memory for "same/previous/last" reference resolution
  contextMemoryCache = new ContextMemoryCache();

  // Initialize ActionResultFormatter with LLM for optional polish layer
  actionResultFormatter = new ActionResultFormatter({
    callLLM: callGemini,
    defaultTimezone: 'America/New_York'
  });

  // Initialize Frappe service for legacy/fallback Frappe operations
  // Per-user Frappe connections are handled via frappeExecute function
  if (process.env.FRAPPE_URL) {
    frappeService = new FrappeService({
      baseUrl: process.env.FRAPPE_URL,
      apiKey: process.env.FRAPPE_API_KEY,
      apiSecret: process.env.FRAPPE_API_SECRET,
    });
    console.log('[Temporal Activities] Frappe service: OK (legacy mode)');
  } else {
    console.log('[Temporal Activities] Frappe service: Per-user mode (no global config)');
  }

  console.log('[Temporal Activities] Initialized (Option A - execution only)');
  console.log('[Temporal Activities] Composio client:', composio ? 'OK' : 'MISSING');
  console.log('[Temporal Activities] Gemini client:', callGemini ? 'OK' : 'MISSING');
  console.log('[Temporal Activities] ActionResultFormatter:', actionResultFormatter ? 'OK' : 'MISSING');
}

// =============================================================================
// CORE EXECUTION ACTIVITY
// =============================================================================

/**
 * Execute a Composio action with retry and timeout handling
 * This is the ONLY activity that makes external API calls
 */
async function executeComposioAction({ action, params, entityId, toolkit }) {
  if (!composioClient) {
    throw ApplicationFailure.nonRetryable('Composio client not initialized');
  }

  // Normalize action names (handle legacy/incorrect names)
  const actionAliases = {
    'SLACK_SEND_CHANNEL_MESSAGE': 'SLACK_SENDS_A_MESSAGE',
    'SLACK_SEND_MESSAGE': 'SLACK_SENDS_A_MESSAGE',
    'JIRA_JQL_SEARCH': 'JIRA_SEARCH_ISSUES',
    'GMAIL_SEND_MESSAGE': 'GMAIL_SEND_EMAIL',
  };
  const normalizedAction = actionAliases[action] || action;

  if (normalizedAction !== action) {
    console.log(`[Activity] Normalized action: ${action} -> ${normalizedAction}`);
    action = normalizedAction;
  }

  console.log(`[Activity] Executing ${action} for entity ${entityId}`);
  console.log(`[Activity] Params:`, JSON.stringify(params));

  // Process calendar-specific parameters
  if (action.includes('GOOGLECALENDAR') || action.includes('CALENDAR')) {
    params = processCalendarParams(action, params);
  }

  try {
    const result = await composioClient.executeAction(action, params, entityId);

    console.log(`[Activity] ${action} completed successfully`);

    // Include timezone info for calendar response formatting
    let responseData = action.includes('CALENDAR')
      ? { ...result, _userTimezone: params._userTimezone }
      : result;

    // CRITICAL: Truncate large payloads to prevent Temporal "Result exceeds size limit" error
    // Temporal history has a 2MB limit, but practical limit is lower for performance
    if (action === 'GMAIL_FETCH_EMAILS' || action === 'GMAIL_LIST_MESSAGES') {
      const messages = responseData.data?.messages || responseData.messages;
      if (Array.isArray(messages) && messages.length > 25) {
        console.log(`[Activity] Truncating Gmail results from ${messages.length} to 25 items`);
        const truncated = messages.slice(0, 25);
        if (responseData.data?.messages) responseData.data.messages = truncated;
        else if (responseData.messages) responseData.messages = truncated;
      }
    } else if (action === 'JIRA_SEARCH_ISSUES' || action === 'JIRA_GET_ISSUES') {
      const issues = responseData.data?.issues || responseData.issues;
      if (Array.isArray(issues) && issues.length > 25) {
        console.log(`[Activity] Truncating Jira results from ${issues.length} to 25 items`);
        const truncated = issues.slice(0, 25);
        if (responseData.data?.issues) responseData.data.issues = truncated;
        else if (responseData.issues) responseData.issues = truncated;
      }
    }

    return {
      success: true,
      data: responseData,
      action,
      toolkit,
    };
  } catch (error) {
    console.error(`[Activity] ${action} failed:`, error.message);

    if (isRetryableError(error)) {
      throw new Error(`${action} failed: ${error.message}`);
    } else {
      throw ApplicationFailure.nonRetryable(
        `${action} failed permanently: ${error.message}`,
        'COMPOSIO_ERROR',
        { action, toolkit, originalError: error.message }
      );
    }
  }
}

// =============================================================================
// FRAPPE EXECUTION ACTIVITY
// =============================================================================

/**
 * Execute a Frappe/ERPNext action
 * This is the activity that handles all FRAPPE_* actions in Temporal workflows
 *
 * @param {Object} params - Activity parameters
 * @param {string} params.action - The Frappe action name (e.g., FRAPPE_CREATE_CUSTOMER)
 * @param {Object} params.params - The action parameters
 * @param {string} params.userId - The user ID for per-user connections
 * @param {string} params.entityId - The entity ID (fallback if no userId)
 */
async function executeFrappeAction({ action, params, userId, entityId }) {
  console.log(`[Activity] Executing Frappe action: ${action}`);
  console.log(`[Activity] Params:`, JSON.stringify(params));
  console.log(`[Activity] UserId: ${userId}, EntityId: ${entityId}`);

  try {
    let result;

    // Try per-user connection first (preferred)
    if (userId) {
      try {
        result = await frappeExecute(userId, action, params);
        console.log(`[Activity] Frappe action ${action} completed via per-user connection`);
      } catch (perUserError) {
        // If per-user fails and we have legacy service, try that
        if (frappeService && frappeService.isConfigured()) {
          console.warn(`[Activity] Per-user Frappe failed, trying legacy service: ${perUserError.message}`);
          result = await frappeService.execute({ actionName: action, params });
        } else {
          throw perUserError;
        }
      }
    } else if (frappeService && frappeService.isConfigured()) {
      // Fall back to legacy global Frappe service
      console.log(`[Activity] Using legacy Frappe service (no userId provided)`);
      result = await frappeService.execute({ actionName: action, params });
    } else {
      throw new Error('No Frappe connection available. Please connect your ERPNext instance or provide userId.');
    }

    // Normalize response format
    const success = result.success !== false;
    const responseData = result.data || result;

    if (!success) {
      throw new Error(result.error || result.message || 'Frappe action failed');
    }

    console.log(`[Activity] Frappe action ${action} completed successfully`);

    return {
      success: true,
      data: responseData,
      action,
      toolkit: 'FRAPPE',
      message: result.message || `${action} completed successfully`,
      doctype: result.doctype || null,
    };
  } catch (error) {
    console.error(`[Activity] Frappe action ${action} failed:`, error.message);

    // Check if error is retryable
    const isRetryable = isRetryableError(error) ||
      error.message?.includes('timeout') ||
      error.message?.includes('ETIMEDOUT') ||
      error.message?.includes('connection');

    if (isRetryable) {
      // Throw regular error for Temporal to retry
      throw new Error(`Frappe ${action} failed (retryable): ${error.message}`);
    } else {
      // Non-retryable error
      throw ApplicationFailure.nonRetryable(
        `Frappe ${action} failed: ${error.message}`,
        'FRAPPE_ERROR',
        { action, originalError: error.message }
      );
    }
  }
}

/**
 * Process calendar-specific parameters (date parsing, timezone handling)
 */
function processCalendarParams(action, params) {
  const processedParams = { ...params };

  // Resolve user's timezone
  const userTimezone = CalendarUtils.resolveTimezone({
    timezone: params.timezone,
    calendarTimezone: 'America/New_York'
  });

  // Validate and fix timeMin/timeMax
  if (processedParams.timeMin) {
    processedParams.timeMin = CalendarUtils.validateAndFixDate(processedParams.timeMin);
  }
  if (processedParams.timeMax) {
    processedParams.timeMax = CalendarUtils.validateAndFixDate(processedParams.timeMax);
  }

  // Default to today for FIND_EVENT
  if (!processedParams.timeMin && !processedParams.timeMax && action.includes('FIND_EVENT')) {
    const timeRange = CalendarUtils.buildCalendarTimeRange('today', { timezone: userTimezone });
    processedParams.timeMin = timeRange.timeMin;
    processedParams.timeMax = timeRange.timeMax;
  }

  // Parse natural language dates - only if not already in ISO format with timezone
  if (processedParams.start_datetime && typeof processedParams.start_datetime === 'string') {
    // Check if already has timezone offset (e.g., 2025-12-18T07:00:00-05:00)
    const hasTimezone = /([zZ]|[+\-]\d{2}:\d{2})$/.test(processedParams.start_datetime);

    if (!hasTimezone) {
      // Try parsing natural language (use current date as base, not timezone string)
      const parsed = parseNaturalDateTime(processedParams.start_datetime, new Date());
      if (parsed) {
        // Ensure the parsed result has timezone
        processedParams.start_datetime = ensureTimezone(parsed, userTimezone);
      } else {
        processedParams.start_datetime = CalendarUtils.validateAndFixDate(processedParams.start_datetime);
      }
    }
    // If it already has timezone, keep it as-is
  }

  if (processedParams.end_datetime && typeof processedParams.end_datetime === 'string') {
    const hasTimezone = /([zZ]|[+\-]\d{2}:\d{2})$/.test(processedParams.end_datetime);

    if (!hasTimezone) {
      const parsed = parseNaturalDateTime(processedParams.end_datetime, new Date());
      if (parsed) {
        processedParams.end_datetime = ensureTimezone(parsed, userTimezone);
      } else {
        processedParams.end_datetime = CalendarUtils.validateAndFixDate(processedParams.end_datetime);
      }
    }
  }

  // Default end time to 1 hour after start (60 minutes)
  if (processedParams.start_datetime && !processedParams.end_datetime) {
    processedParams.end_datetime = addDurationToTime(processedParams.start_datetime, 60);
  }

  processedParams._userTimezone = userTimezone;

  console.log(`[Activity] Calendar params processed: start=${processedParams.start_datetime}, end=${processedParams.end_datetime}`);

  return processedParams;
}

/**
 * Ensure a datetime string has timezone offset
 */
function ensureTimezone(dateStr, timezone) {
  if (!dateStr) return dateStr;

  // If already has timezone, return as-is
  if (/([zZ]|[+\-]\d{2}:\d{2})$/.test(dateStr)) {
    return dateStr;
  }

  // Get offset for the given timezone
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
    }).formatToParts(date);

    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
    const match = tzPart.match(/GMT([+\-]\d{1,2})(?::?(\d{2}))?/i);

    if (match) {
      const rawH = parseInt(match[1], 10);
      const sign = rawH < 0 ? '-' : '+';
      const hh = String(Math.abs(rawH)).padStart(2, '0');
      const mm = String(match[2] ? parseInt(match[2], 10) : 0).padStart(2, '0');
      return `${dateStr}${sign}${hh}:${mm}`;
    }
  } catch (e) {
    console.warn('[Activity] Could not determine timezone offset:', e.message);
  }

  // Fallback: append America/New_York offset (-05:00 or -04:00)
  return `${dateStr}-05:00`;
}

// =============================================================================
// RESULT FORMATTING ACTIVITY
// =============================================================================

/**
 * Format results for user display
 * Uses ActionResultFormatter for consistent, production-ready formatting
 */
async function formatResults({ results, originalMessage }) {
  console.log('[Activity] Formatting results');

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (successful.length === 0) {
    return `I couldn't complete that. ${failed[0]?.error || 'Something went wrong.'}`;
  }

  const lines = [];

  for (const result of successful) {
    const data = result.data;
    const action = result.action || '';

    // Use ActionResultFormatter if available (has LLM support)
    if (actionResultFormatter) {
      try {
        const formatted = await actionResultFormatter.format(action, {
          success: true,
          data: data,
          error: null,
        }, {}, { timezone: 'America/New_York' });

        if (formatted && formatted.summary) {
          // Include both summary AND details for full context
          if (formatted.details) {
            lines.push(`${formatted.summary}\n\n${formatted.details}`);
          } else {
            lines.push(formatted.summary);
          }
          continue;
        }
      } catch (err) {
        console.warn('[Activity] ActionResultFormatter error, using fallback:', err.message);
      }
    }

    // Fallback to legacy formatters if ActionResultFormatter fails or is not available
    if (action.includes('SEARCH') || action.includes('LIST') || action.includes('FETCH') || action.includes('GET')) {
      lines.push(formatSearchResults(action, data));
    } else if (action.includes('CREATE')) {
      lines.push(formatCreateResult(action, data));
    } else if (action.includes('SEND')) {
      lines.push(formatSendResult(action, data));
    } else if (action.includes('UPDATE')) {
      lines.push(formatUpdateResult(action, data));
    } else if (action.includes('DELETE')) {
      lines.push(`✅ Deleted successfully`);
    } else {
      // Try data structure detection
      const structureResponse = AssistantComposer.composeByDataStructure(data, { timezone: 'America/New_York' });
      if (structureResponse) {
        lines.push(structureResponse);
      } else {
        lines.push(`✅ Completed ${action || result.taskId || 'task'}`);
      }
    }
  }

  if (failed.length > 0) {
    lines.push(`\n❌ Failed: ${failed.map(f => f.error).join(', ')}`);
  }

  return lines.filter(Boolean).join('\n').trim();
}

function formatSearchResults(action, data) {
  if (action === 'JIRA_SEARCH_ISSUES') {
    // Handle Composio nested response: { success: true, data: { response_data: { issues: [...] } } }
    // or { success: true, data: { issues: [...] } }
    // or { data: { issues: [...] } }
    // or { issues: [...] }
    let unwrapped = data;
    if (data?.success === true && data?.data) {
      unwrapped = data.data;
    }
    if (unwrapped?.response_data?.issues) {
      unwrapped = unwrapped.response_data;
    }
    const issues = unwrapped?.issues || data?.data?.issues || data?.issues || [];
    if (issues.length === 0) return 'No issues found matching your criteria.\n';

    let msg = `Found ${issues.length} Jira issue${issues.length > 1 ? 's' : ''}:\n\n`;
    for (const issue of issues.slice(0, 10)) {
      const key = issue.key || issue.id;
      const summary = issue.summary || issue.fields?.summary || 'No summary';
      const status = issue.status?.name || issue.fields?.status?.name || '';
      msg += `• **${key}**: ${summary}${status ? ` [${status}]` : ''}\n`;
    }
    return msg;
  }

  if (action.includes('GOOGLECALENDAR')) {
    const userTimezone = data?._userTimezone || 'America/New_York';
    const normalized = CalendarUtils.normalizeCalendarEvents(data, userTimezone);

    if (normalized.events.length === 0) {
      return 'No calendar events found.\n';
    }

    const formatted = CalendarUtils.formatCalendarResponse(normalized, userTimezone);
    return formatted.message + '\n';
  }

  if (action === 'GMAIL_FETCH_EMAILS') {
    const emails = data?.data?.messages || data?.messages || [];
    if (emails.length === 0) return 'No emails found.\n';

    let msg = `Found ${emails.length} email${emails.length > 1 ? 's' : ''}:\n\n`;
    for (const email of emails.slice(0, 10)) {
      const headers = email?.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || email?.subject || '(No subject)';
      const sender = headers.find(h => h.name === 'From')?.value || email?.sender || '(Unknown)';
      msg += `📧 **${subject}**\n   From: ${sender}\n\n`;
    }
    return msg;
  }

  if (action.includes('SLACK')) {
    const messages = data?.messages || [];
    if (messages.length === 0) return 'No Slack messages found.\n';
    return `Found ${messages.length} Slack message${messages.length > 1 ? 's' : ''}\n`;
  }

  return `Found results for ${action}\n`;
}

function formatCreateResult(action, data) {
  if (action === 'JIRA_CREATE_ISSUE') {
    const key = data?.data?.key || data?.key;
    const url = data?.data?.browser_url || data?.browser_url || '';
    return `✅ Created Jira issue **${key}**${url ? ` - ${url}` : ''}\n`;
  }
  if (action === 'GOOGLECALENDAR_CREATE_EVENT') {
    const link = data?.data?.htmlLink || data?.htmlLink || '';
    return `✅ Created calendar event${link ? ` - ${link}` : ''}\n`;
  }
  return `✅ Created successfully\n`;
}

function formatSendResult(action, data) {
  if (action === 'GMAIL_SEND_EMAIL') {
    return `✅ Email sent successfully\n`;
  }
  if (action.includes('SLACK')) {
    return `✅ Message sent to Slack\n`;
  }
  return `✅ Sent successfully\n`;
}

function formatUpdateResult(action, data) {
  if (action.includes('JIRA')) {
    return `✅ Jira issue updated\n`;
  }
  if (action.includes('GOOGLECALENDAR')) {
    return `✅ Calendar event updated\n`;
  }
  return `✅ Updated successfully\n`;
}

// =============================================================================
// CONTEXT MEMORY ACTIVITIES
// =============================================================================

/**
 * Store action params after successful execution
 * Enables "same/previous/last" reference resolution in future requests
 */
async function storeActionParams({ entityId, action, params, result, conversationId = 'default' }) {
  if (!contextMemoryCache) {
    console.warn('[Activity] ContextMemoryCache not initialized');
    return { success: false };
  }

  try {
    await contextMemoryCache.storeActionParams(entityId, action, params, result, conversationId);
    console.log(`[Activity] Stored params for ${action}`);
    return { success: true, action };
  } catch (error) {
    console.error('[Activity] Error storing params:', error.message);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// EMAIL GENERATION ACTIVITY
// =============================================================================

/**
 * Generate email body from content source (Jira issues, calendar events, etc.)
 */
async function generateEmailBodyFromData({ contentType, data, options = {} }) {
  try {
    const result = generateEmailBody(contentType, data, options);
    console.log('[Activity] Generated email body:', { contentType, success: result.success });
    return result;
  } catch (error) {
    console.error('[Activity] Error generating email body:', error.message);
    return { success: false, body: null, error: error.message };
  }
}

// =============================================================================
// AI SUMMARIZATION ACTIVITY
// =============================================================================

/**
 * Summarize data using AI to reduce payload size before injection
 * This is especially useful for email lists which can be very large
 */
async function summarizeDataWithAI({ data, dataType, maxItems = 20, options = {} }) {
  if (!geminiClient) {
    console.warn('[Activity] Gemini client not available, using fallback formatting');
    return { success: false, summary: null, error: 'Gemini not available' };
  }

  try {
    // Extract items based on data type
    let items = [];
    let itemLabel = 'items';

    if (dataType === 'emails' || dataType === 'email_summary') {
      items = data?.data?.messages || data?.messages || [];
      itemLabel = 'emails';
    } else if (dataType === 'jira_issues') {
      items = data?.data?.issues || data?.issues || [];
      itemLabel = 'Jira issues';
    } else if (dataType === 'calendar_events') {
      items = data?.data?.items || data?.items || data?.events || [];
      itemLabel = 'calendar events';
    } else if (Array.isArray(data)) {
      items = data;
    }

    if (items.length === 0) {
      return { success: false, summary: null, error: 'No items to summarize' };
    }

    // Prepare compact version of items for AI
    const compactItems = items.slice(0, maxItems).map(item => {
      if (dataType === 'emails' || dataType === 'email_summary') {
        // Extract just essential email info
        const headers = item.payload?.headers || [];
        const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || item.subject || '(No subject)';
        const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value || item.from || 'Unknown';
        const date = item.messageTimestamp || item.internalDate || '';
        const snippet = item.snippet || (item.messageText?.substring(0, 150)) || '';
        return { subject, from, date, snippet };
      } else if (dataType === 'jira_issues') {
        return {
          key: item.key || item.id,
          summary: item.fields?.summary || item.summary,
          status: item.fields?.status?.name || item.status,
          assignee: item.fields?.assignee?.displayName || item.assignee,
        };
      } else if (dataType === 'calendar_events') {
        return {
          title: item.summary || 'Untitled',
          start: item.start?.dateTime || item.start?.date,
          end: item.end?.dateTime || item.end?.date,
          location: item.location,
        };
      }
      return item;
    });

    const systemPrompt = `You are a professional assistant that creates concise, well-formatted summaries for email inclusion.

Format the following ${items.length} ${itemLabel} into a clean, readable summary suitable for sending in an email body.

FORMATTING RULES:
- Use bullet points (•) for each item
- Include essential details only (subject, sender, date for emails; key, summary, status for Jira)
- Format dates in a readable way
- Keep each item to 1-2 lines
- Add a brief intro line mentioning the total count
- Do NOT include raw JSON or technical formatting

OUTPUT: Plain text formatted summary, ready to paste into email body.`;

    const userPrompt = `Summarize these ${items.length} ${itemLabel}:\n\n${JSON.stringify(compactItems, null, 2)}`;

    console.log(`[Activity] Summarizing ${items.length} ${itemLabel} with AI...`);

    const summary = await geminiClient(systemPrompt, userPrompt, 0);

    if (summary && summary.length > 10) {
      console.log(`[Activity] AI summarization successful (${summary.length} chars)`);
      return {
        success: true,
        summary,
        itemCount: items.length,
        truncated: items.length > maxItems,
      };
    }

    return { success: false, summary: null, error: 'AI returned empty summary' };
  } catch (error) {
    console.error('[Activity] AI summarization failed:', error.message);
    return { success: false, summary: null, error: error.message };
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function isRetryableError(error) {
  const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'RATE_LIMIT'];
  const retryableStatus = [408, 429, 500, 502, 503, 504];

  if (error.code && retryableCodes.includes(error.code)) return true;
  if (error.status && retryableStatus.includes(error.status)) return true;
  if (error.message?.toLowerCase().includes('rate limit')) return true;
  if (error.message?.toLowerCase().includes('timeout')) return true;

  return false;
}

// =============================================================================
// EXPORTS - Only execution activities needed by orchestrationWorkflow.js
// =============================================================================

module.exports = {
  // Initialization
  initializeActivities,

  // Core execution (the main activity)
  executeComposioAction,

  // Frappe execution (for FRAPPE_* actions)
  executeFrappeAction,

  // Result formatting
  formatResults,

  // Context memory (for "same/previous" references)
  storeActionParams,

  // Email generation
  generateEmailBodyFromData,

  // AI summarization (for large data sets)
  summarizeDataWithAI,
};

