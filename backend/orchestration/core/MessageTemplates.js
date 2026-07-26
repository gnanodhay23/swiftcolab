/**
 * MessageTemplates.js
 *
 * User-friendly and debug message generation for normalized results.
 * Provides contextual messages based on action, status, and parameters.
 */

const { NORMALIZED_STATUS, SUB_STATUS } = require('./StatusMappings');

// =============================================================================
// MESSAGE TEMPLATES BY STATUS
// =============================================================================

const STATUS_MESSAGES = {
  [NORMALIZED_STATUS.SUCCESS]: {
    default: 'Operation completed successfully.',
    user: 'Done!',
    debug: 'Action executed successfully.',
  },

  [NORMALIZED_STATUS.PARTIAL_SUCCESS]: {
    default: 'Operation partially completed.',
    user: 'Mostly done, but some parts had issues.',
    debug: 'Action completed with partial success - some operations failed.',
  },

  [NORMALIZED_STATUS.RETRYABLE_FAILURE]: {
    default: 'Operation failed but can be retried.',
    user: 'Something went wrong. Please try again in a moment.',
    debug: 'Temporary failure detected - retry recommended.',
  },

  [NORMALIZED_STATUS.PERMISSION_FAILURE]: {
    default: 'Permission denied.',
    user: 'I don\'t have permission to do that. You may need to reconnect the app.',
    debug: 'Authorization failure - check token validity and scopes.',
  },

  [NORMALIZED_STATUS.VALIDATION_FAILURE]: {
    default: 'Invalid input provided.',
    user: 'Some of the information provided wasn\'t quite right.',
    debug: 'Validation error - check input parameters.',
  },

  [NORMALIZED_STATUS.QUOTA_FAILURE]: {
    default: 'Rate limit or quota exceeded.',
    user: 'We\'ve hit a limit. Please wait a bit before trying again.',
    debug: 'Quota/rate limit exceeded - implement backoff.',
  },

  [NORMALIZED_STATUS.NOT_FOUND]: {
    default: 'Resource not found.',
    user: 'I couldn\'t find what you\'re looking for.',
    debug: 'Resource not found - verify ID/reference.',
  },

  [NORMALIZED_STATUS.CONFLICT]: {
    default: 'Conflict with existing resource.',
    user: 'This conflicts with something that already exists.',
    debug: 'Conflict detected - check for duplicates or version mismatch.',
  },

  [NORMALIZED_STATUS.UNKNOWN_FAILURE]: {
    default: 'An unexpected error occurred.',
    user: 'Something unexpected happened. Please try again.',
    debug: 'Unknown failure - check logs for details.',
  },
};

// =============================================================================
// SUB-STATUS SPECIFIC MESSAGES
// =============================================================================

const SUB_STATUS_MESSAGES = {
  // Retryable
  [SUB_STATUS.RATE_LIMITED]: {
    user: 'We\'re being rate limited. I\'ll retry automatically in a moment.',
    debug: 'Rate limited - retry after delay.',
    action_hint: 'Automatic retry scheduled.',
  },
  [SUB_STATUS.TIMEOUT]: {
    user: 'The request took too long. Let me try again.',
    debug: 'Request timeout - consider increasing timeout or retrying.',
    action_hint: 'Retry with extended timeout.',
  },
  [SUB_STATUS.SERVICE_UNAVAILABLE]: {
    user: 'The service is temporarily unavailable. Please try again shortly.',
    debug: 'Service unavailable (503) - backend may be down.',
    action_hint: 'Retry after a brief delay.',
  },
  [SUB_STATUS.NETWORK_ERROR]: {
    user: 'Network issue detected. Please check your connection.',
    debug: 'Network error - check connectivity.',
    action_hint: 'Check network and retry.',
  },
  [SUB_STATUS.TEMPORARY_ERROR]: {
    user: 'A temporary error occurred. Retrying...',
    debug: 'Temporary server error - retry recommended.',
    action_hint: 'Retry automatically.',
  },

  // Permission
  [SUB_STATUS.TOKEN_EXPIRED]: {
    user: 'Your session has expired. Please reconnect the app.',
    debug: 'OAuth token expired - require re-authentication.',
    action_hint: 'Reconnect the integration.',
  },
  [SUB_STATUS.INSUFFICIENT_SCOPE]: {
    user: 'I need additional permissions. Please reconnect and grant the required access.',
    debug: 'Missing OAuth scope - need to request additional permissions.',
    action_hint: 'Reconnect with expanded scopes.',
  },
  [SUB_STATUS.ACCESS_DENIED]: {
    user: 'Access denied. You may not have permission for this resource.',
    debug: 'Access denied - check resource permissions.',
    action_hint: 'Verify resource access rights.',
  },
  [SUB_STATUS.CALENDAR_ACCESS_DENIED]: {
    user: 'I don\'t have access to this calendar. Please check sharing settings.',
    debug: 'Calendar access denied - verify calendar permissions.',
    action_hint: 'Check calendar sharing settings.',
  },

  // Validation
  [SUB_STATUS.INVALID_DATE]: {
    user: 'The date or time format wasn\'t recognized. Try something like "tomorrow at 3pm".',
    debug: 'Invalid date/time format - parsing failed.',
    action_hint: 'Provide a clearer date format.',
  },
  [SUB_STATUS.INVALID_EMAIL]: {
    user: 'One or more email addresses appear to be invalid.',
    debug: 'Invalid email format detected.',
    action_hint: 'Verify email addresses.',
  },
  [SUB_STATUS.MISSING_REQUIRED_FIELD]: {
    user: 'Some required information is missing.',
    debug: 'Required field not provided.',
    action_hint: 'Provide missing required fields.',
  },
  [SUB_STATUS.INVALID_FORMAT]: {
    user: 'The format of some information wasn\'t quite right.',
    debug: 'Invalid format for one or more fields.',
    action_hint: 'Check input formatting.',
  },

  // Quota
  [SUB_STATUS.DAILY_LIMIT]: {
    user: 'Daily limit reached. This will reset tomorrow.',
    debug: 'Daily API quota exceeded.',
    action_hint: 'Wait until quota resets or upgrade plan.',
  },
  [SUB_STATUS.USER_RATE_LIMIT]: {
    user: 'Too many requests. Please slow down a bit.',
    debug: 'Per-user rate limit hit.',
    action_hint: 'Implement request throttling.',
  },
  [SUB_STATUS.STORAGE_FULL]: {
    user: 'Storage is full. Please free up some space.',
    debug: 'Storage quota exceeded.',
    action_hint: 'Clean up storage or upgrade.',
  },

  // Not found
  [SUB_STATUS.EVENT_NOT_FOUND]: {
    user: 'I couldn\'t find that event. It may have been deleted.',
    debug: 'Calendar event not found - may be deleted or ID invalid.',
    action_hint: 'Verify event still exists.',
  },
  [SUB_STATUS.CALENDAR_NOT_FOUND]: {
    user: 'I couldn\'t find that calendar.',
    debug: 'Calendar not found - verify calendar ID.',
    action_hint: 'Check calendar exists and is accessible.',
  },
  [SUB_STATUS.EMAIL_NOT_FOUND]: {
    user: 'I couldn\'t find that email.',
    debug: 'Email/message not found.',
    action_hint: 'Verify email ID.',
  },
  [SUB_STATUS.USER_NOT_FOUND]: {
    user: 'I couldn\'t find that user.',
    debug: 'User not found in system.',
    action_hint: 'Verify user exists.',
  },
  [SUB_STATUS.CHANNEL_NOT_FOUND]: {
    user: 'I couldn\'t find that channel.',
    debug: 'Slack channel not found.',
    action_hint: 'Verify channel name/ID.',
  },
  [SUB_STATUS.TICKET_NOT_FOUND]: {
    user: 'I couldn\'t find that ticket.',
    debug: 'Jira issue not found.',
    action_hint: 'Verify ticket key.',
  },

  // Conflict
  [SUB_STATUS.ALREADY_EXISTS]: {
    user: 'Something with that name or ID already exists.',
    debug: 'Duplicate resource detected.',
    action_hint: 'Use a different identifier or update existing.',
  },
  [SUB_STATUS.VERSION_CONFLICT]: {
    user: 'This was modified by someone else. Please refresh and try again.',
    debug: 'ETag/version mismatch - concurrent modification.',
    action_hint: 'Refresh and retry with updated version.',
  },
  [SUB_STATUS.CONCURRENT_MODIFICATION]: {
    user: 'Someone else made changes at the same time. Please try again.',
    debug: 'Concurrent modification detected.',
    action_hint: 'Retry after fetching latest state.',
  },

  // Partial success
  [SUB_STATUS.SOME_RECIPIENTS_FAILED]: {
    user: 'Sent to most recipients, but some couldn\'t be reached.',
    debug: 'Partial delivery - some recipients failed.',
    action_hint: 'Check failed recipients list.',
  },
  [SUB_STATUS.SOME_ATTENDEES_FAILED]: {
    user: 'Event created, but some attendees couldn\'t be added.',
    debug: 'Partial attendee addition - some failed.',
    action_hint: 'Check failed attendees list.',
  },
  [SUB_STATUS.CREATED_WITHOUT_NOTIFICATIONS]: {
    user: 'Created successfully, but notifications weren\'t sent.',
    debug: 'Created but notification delivery failed.',
    action_hint: 'Notifications may need manual sending.',
  },
  [SUB_STATUS.PARTIAL_UPDATE]: {
    user: 'Some fields were updated, but others couldn\'t be changed.',
    debug: 'Partial update - some fields failed.',
    action_hint: 'Check which fields were updated.',
  },
};

// =============================================================================
// ACTION-SPECIFIC MESSAGE TEMPLATES
// =============================================================================

const ACTION_MESSAGES = {
  // Google Calendar
  GOOGLECALENDAR_CREATE_EVENT: {
    success: 'Event "{title}" created for {start_datetime}.',
    partial: 'Event created, but {partial_details}.',
    failure: 'Couldn\'t create the event.',
    debug_context: ['event_id', 'calendar_id'],
  },
  GOOGLECALENDAR_UPDATE_EVENT: {
    success: 'Event updated successfully.',
    partial: 'Event partially updated.',
    failure: 'Couldn\'t update the event.',
    debug_context: ['event_id', 'updated_fields'],
  },
  GOOGLECALENDAR_DELETE_EVENT: {
    success: 'Event deleted.',
    failure: 'Couldn\'t delete the event.',
    debug_context: ['event_id'],
  },
  GOOGLECALENDAR_FIND_EVENT: {
    success: 'Found {count} event(s).',
    failure: 'Couldn\'t search for events.',
    debug_context: ['query', 'time_range'],
  },
  GOOGLECALENDAR_FIND_FREE_SLOTS: {
    success: 'Found {count} free slot(s).',
    failure: 'Couldn\'t find free slots.',
    debug_context: ['time_range', 'duration'],
  },

  // Gmail
  GMAIL_SEND_EMAIL: {
    success: 'Email sent to {recipients}.',
    partial: 'Email sent to some recipients.',
    failure: 'Couldn\'t send the email.',
    debug_context: ['message_id', 'thread_id'],
  },
  GMAIL_CREATE_EMAIL_DRAFT: {
    success: 'Draft created.',
    failure: 'Couldn\'t create the draft.',
    debug_context: ['draft_id'],
  },
  GMAIL_FETCH_EMAILS: {
    success: 'Found {count} email(s).',
    failure: 'Couldn\'t fetch emails.',
    debug_context: ['query', 'count'],
  },
  GMAIL_GET_EMAIL: {
    success: 'Email retrieved.',
    failure: 'Couldn\'t get the email.',
    debug_context: ['message_id'],
  },

  // Slack
  SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL: {
    success: 'Message sent to #{channel}.',
    partial: 'Message sent, but {partial_details}.',
    failure: 'Couldn\'t send the message.',
    debug_context: ['channel', 'ts'],
  },

  // Jira
  JIRA_CREATE_JIRA_ISSUE: {
    success: 'Ticket {key} created.',
    failure: 'Couldn\'t create the ticket.',
    debug_context: ['issue_key', 'project'],
  },
  JIRA_GET_JIRA_ISSUE_DETAILS: {
    success: 'Retrieved ticket {key}.',
    failure: 'Couldn\'t get ticket details.',
    debug_context: ['issue_key'],
  },
  JIRA_UPDATE_JIRA_ISSUE: {
    success: 'Ticket {key} updated.',
    partial: 'Ticket partially updated.',
    failure: 'Couldn\'t update the ticket.',
    debug_context: ['issue_key', 'updated_fields'],
  },
  JIRA_ADD_COMMENT: {
    success: 'Comment added to {key}.',
    failure: 'Couldn\'t add the comment.',
    debug_context: ['issue_key', 'comment_id'],
  },
};

// =============================================================================
// MESSAGE GENERATION FUNCTIONS
// =============================================================================

/**
 * Generate user-friendly message based on status and context
 */
function generateUserMessage(status, sub_status, actionName, params = {}, result = {}) {
  // Start with sub-status specific message if available
  if (sub_status && SUB_STATUS_MESSAGES[sub_status]) {
    return SUB_STATUS_MESSAGES[sub_status].user;
  }

  // Check for action-specific message
  const actionTemplate = ACTION_MESSAGES[actionName];
  if (actionTemplate) {
    let template;

    if (status === NORMALIZED_STATUS.SUCCESS) {
      template = actionTemplate.success;
    } else if (status === NORMALIZED_STATUS.PARTIAL_SUCCESS) {
      template = actionTemplate.partial || actionTemplate.success;
    } else {
      template = actionTemplate.failure;
    }

    if (template) {
      return interpolateTemplate(template, { ...params, ...result });
    }
  }

  // Fall back to status message
  return STATUS_MESSAGES[status]?.user || STATUS_MESSAGES[NORMALIZED_STATUS.UNKNOWN_FAILURE].user;
}

/**
 * Generate debug message with technical details
 */
function generateDebugMessage(status, sub_status, actionName, context = {}) {
  const parts = [];

  // Add status-level debug message
  const statusMsg = STATUS_MESSAGES[status]?.debug || 'Unknown status';
  parts.push(statusMsg);

  // Add sub-status details
  if (sub_status && SUB_STATUS_MESSAGES[sub_status]) {
    parts.push(SUB_STATUS_MESSAGES[sub_status].debug);
  }

  // Add action-specific context
  const actionTemplate = ACTION_MESSAGES[actionName];
  if (actionTemplate?.debug_context && context) {
    const contextParts = actionTemplate.debug_context
      .filter(key => context[key] !== undefined)
      .map(key => `${key}=${JSON.stringify(context[key])}`);

    if (contextParts.length > 0) {
      parts.push(`Context: ${contextParts.join(', ')}`);
    }
  }

  // Add error details
  if (context.error_code) {
    parts.push(`Error code: ${context.error_code}`);
  }
  if (context.error_message) {
    parts.push(`Provider message: ${context.error_message}`);
  }

  return parts.join(' | ');
}

/**
 * Generate action hint for recovery
 */
function generateActionHint(status, sub_status) {
  if (sub_status && SUB_STATUS_MESSAGES[sub_status]?.action_hint) {
    return SUB_STATUS_MESSAGES[sub_status].action_hint;
  }

  // Default hints by status
  switch (status) {
    case NORMALIZED_STATUS.RETRYABLE_FAILURE:
      return 'Retry the operation.';
    case NORMALIZED_STATUS.PERMISSION_FAILURE:
      return 'Check permissions or reconnect the integration.';
    case NORMALIZED_STATUS.VALIDATION_FAILURE:
      return 'Check input parameters and try again.';
    case NORMALIZED_STATUS.QUOTA_FAILURE:
      return 'Wait before retrying.';
    case NORMALIZED_STATUS.NOT_FOUND:
      return 'Verify the resource exists.';
    case NORMALIZED_STATUS.CONFLICT:
      return 'Resolve the conflict and retry.';
    default:
      return 'Try again or contact support.';
  }
}

/**
 * Generate a complete message object
 */
function generateMessages(status, sub_status, actionName, params = {}, result = {}, errorContext = {}) {
  return {
    user: generateUserMessage(status, sub_status, actionName, params, result),
    debug: generateDebugMessage(status, sub_status, actionName, { ...result, ...errorContext }),
    action_hint: generateActionHint(status, sub_status),
    raw_error: errorContext.error_message || null,
  };
}

/**
 * Generate partial success explanation
 */
function generatePartialSuccessMessage(actionName, successItems, failedItems) {
  const successCount = Array.isArray(successItems) ? successItems.length : (successItems || 0);
  const failedCount = Array.isArray(failedItems) ? failedItems.length : (failedItems || 0);

  const actionMessages = {
    GMAIL_SEND_EMAIL: {
      message: `Sent to ${successCount} recipient(s), ${failedCount} failed.`,
      details: failedItems?.map(f => `${f.email}: ${f.reason}`),
    },
    GOOGLECALENDAR_CREATE_EVENT: {
      message: `Event created. ${successCount} attendee(s) added, ${failedCount} couldn't be added.`,
      details: failedItems?.map(f => `${f.email}: ${f.reason}`),
    },
    SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL: {
      message: `Message sent but some features failed.`,
      details: failedItems,
    },
    JIRA_UPDATE_JIRA_ISSUE: {
      message: `${successCount} field(s) updated, ${failedCount} couldn't be changed.`,
      details: failedItems?.map(f => `${f.field}: ${f.reason}`),
    },
  };

  const template = actionMessages[actionName] || {
    message: `Operation partially completed. ${successCount} succeeded, ${failedCount} failed.`,
    details: failedItems,
  };

  return {
    summary: template.message,
    details: template.details,
    success_count: successCount,
    failed_count: failedCount,
  };
}

/**
 * Generate retry timing message
 */
function generateRetryMessage(retryInfo) {
  if (!retryInfo || !retryInfo.should_retry) {
    return null;
  }

  const { delay_ms, attempt, max_attempts } = retryInfo;
  const delaySeconds = Math.ceil(delay_ms / 1000);

  if (delay_ms > 60000) {
    const minutes = Math.ceil(delay_ms / 60000);
    return `Retry ${attempt}/${max_attempts} in ${minutes} minute(s).`;
  }

  return `Retry ${attempt}/${max_attempts} in ${delaySeconds} second(s).`;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Simple template interpolation
 * Replaces {key} with params[key]
 */
function interpolateTemplate(template, params) {
  if (!template || !params) return template;

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];

    if (value === undefined || value === null) {
      return match; // Keep placeholder if no value
    }

    // Format arrays nicely
    if (Array.isArray(value)) {
      if (value.length === 0) return 'none';
      if (value.length === 1) return value[0];
      if (value.length === 2) return `${value[0]} and ${value[1]}`;
      return `${value.slice(0, -1).join(', ')}, and ${value[value.length - 1]}`;
    }

    return String(value);
  });
}

/**
 * Format datetime for user display
 */
function formatDateTimeForUser(isoString) {
  if (!isoString) return 'unknown time';

  try {
    const date = new Date(isoString);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const timeStr = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    // Check if today
    if (date.toDateString() === now.toDateString()) {
      return `today at ${timeStr}`;
    }

    // Check if tomorrow
    if (date.toDateString() === tomorrow.toDateString()) {
      return `tomorrow at ${timeStr}`;
    }

    // Otherwise show day and date
    const dayStr = date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });

    return `${dayStr} at ${timeStr}`;
  } catch {
    return isoString;
  }
}

/**
 * Format recipient list for display
 */
function formatRecipients(recipients) {
  if (!recipients) return 'unknown';

  const list = Array.isArray(recipients) ? recipients : [recipients];

  if (list.length === 0) return 'no recipients';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list[0]} and ${list.length - 1} other(s)`;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Message templates
  STATUS_MESSAGES,
  SUB_STATUS_MESSAGES,
  ACTION_MESSAGES,

  // Generation functions
  generateUserMessage,
  generateDebugMessage,
  generateActionHint,
  generateMessages,
  generatePartialSuccessMessage,
  generateRetryMessage,

  // Helpers
  interpolateTemplate,
  formatDateTimeForUser,
  formatRecipients,
};
