/**
 * ResultNormalizer.js
 *
 * Main class for normalizing provider responses into a consistent format.
 * Integrates status classification, message generation, partial success detection,
 * and retry strategy resolution.
 */

const {
  NORMALIZED_STATUS,
  SUB_STATUS,
  classifyStatus,
  isRetryable,
  isSuccess,
  isUserFixable,
  needsReconnection,
  extractErrorCode,
  extractErrorMessage,
  detectProvider,
} = require('./StatusMappings');

const {
  generateMessages,
  generatePartialSuccessMessage,
  generateRetryMessage,
  formatDateTimeForUser,
  formatRecipients,
} = require('./MessageTemplates');

// =============================================================================
// RETRY STRATEGY CONFIGURATION
// =============================================================================

const RETRY_STRATEGIES = {
  // For rate limiting - use exponential backoff with longer delays
  [SUB_STATUS.RATE_LIMITED]: {
    max_attempts: 5,
    base_delay_ms: 5000,
    max_delay_ms: 120000,
    backoff_multiplier: 2,
    jitter: true,
  },
  // For timeouts - retry quickly a few times
  [SUB_STATUS.TIMEOUT]: {
    max_attempts: 3,
    base_delay_ms: 1000,
    max_delay_ms: 10000,
    backoff_multiplier: 2,
    jitter: false,
  },
  // For service unavailable - moderate backoff
  [SUB_STATUS.SERVICE_UNAVAILABLE]: {
    max_attempts: 4,
    base_delay_ms: 3000,
    max_delay_ms: 60000,
    backoff_multiplier: 2,
    jitter: true,
  },
  // For network errors - quick retries
  [SUB_STATUS.NETWORK_ERROR]: {
    max_attempts: 3,
    base_delay_ms: 500,
    max_delay_ms: 5000,
    backoff_multiplier: 2,
    jitter: false,
  },
  // For temporary errors - standard backoff
  [SUB_STATUS.TEMPORARY_ERROR]: {
    max_attempts: 3,
    base_delay_ms: 2000,
    max_delay_ms: 30000,
    backoff_multiplier: 2,
    jitter: true,
  },
  // For daily limits - no retry, wait until reset
  [SUB_STATUS.DAILY_LIMIT]: {
    max_attempts: 1,
    base_delay_ms: 0,
    should_retry: false,
    wait_until_reset: true,
  },
  // Default strategy
  default: {
    max_attempts: 3,
    base_delay_ms: 1000,
    max_delay_ms: 30000,
    backoff_multiplier: 2,
    jitter: true,
  },
};

// =============================================================================
// NORMALIZED RESULT SCHEMA
// =============================================================================

/**
 * Create empty normalized result structure
 */
function createNormalizedResult() {
  return {
    // Core status
    status: NORMALIZED_STATUS.UNKNOWN_FAILURE,
    sub_status: null,
    success: false,

    // Original response (for debugging)
    raw_response: null,

    // Extracted data
    data: null,
    resource_id: null,

    // Partial success info
    partial_results: null,

    // Retry information
    retry: {
      should_retry: false,
      attempt: 0,
      max_attempts: 3,
      delay_ms: 0,
      strategy: null,
    },

    // Messages
    messages: {
      user: '',
      debug: '',
      action_hint: null,
      raw_error: null,
    },

    // Metadata
    metadata: {
      action_name: null,
      provider: null,
      normalized_at: new Date().toISOString(),
      classification_source: null,
    },
  };
}

// =============================================================================
// RESULT NORMALIZER CLASS
// =============================================================================

class ResultNormalizer {
  constructor(options = {}) {
    this.retryStrategies = { ...RETRY_STRATEGIES, ...options.retryStrategies };
    this.customExtractors = options.customExtractors || {};
    this.customPartialDetectors = options.customPartialDetectors || {};
  }

  /**
   * Main normalization method
   * Takes raw provider response and returns normalized result
   */
  normalize(actionName, rawResponse, params = {}, context = {}) {
    const result = createNormalizedResult();
    result.raw_response = rawResponse;
    result.metadata.action_name = actionName;

    // Step 1: Detect provider
    result.metadata.provider = detectProvider(actionName, rawResponse);

    // Step 2: Check if response indicates success
    const isRawSuccess = this._checkRawSuccess(rawResponse, actionName);

    // Step 3: Classify status
    if (isRawSuccess) {
      // Check for partial success
      const partialResult = this._detectPartialSuccess(actionName, rawResponse, params);
      if (partialResult.isPartial) {
        result.status = NORMALIZED_STATUS.PARTIAL_SUCCESS;
        result.sub_status = partialResult.sub_status;
        result.partial_results = partialResult.details;
      } else {
        result.status = NORMALIZED_STATUS.SUCCESS;
        result.sub_status = this._detectSuccessSubStatus(actionName, rawResponse);
      }
      result.success = true;
    } else {
      // Classify failure
      const classification = classifyStatus(
        actionName,
        rawResponse,
        context.httpStatus
      );
      result.status = classification.status;
      result.sub_status = classification.sub_status;
      result.metadata.classification_source = classification.source;
      result.success = false;
    }

    // Step 4: Extract data and resource ID
    result.data = this._extractData(actionName, rawResponse);
    result.resource_id = this._extractResourceId(actionName, rawResponse);

    // Step 5: Determine retry strategy
    if (!result.success && isRetryable(result.status)) {
      result.retry = this._determineRetryStrategy(
        result.status,
        result.sub_status,
        context.attempt || 0,
        rawResponse
      );
    }

    // Step 6: Generate messages
    const errorContext = {
      error_code: extractErrorCode(rawResponse),
      error_message: extractErrorMessage(rawResponse),
      ...result.data,
    };

    result.messages = generateMessages(
      result.status,
      result.sub_status,
      actionName,
      params,
      result.data,
      errorContext
    );

    // Add partial success message if applicable
    if (result.status === NORMALIZED_STATUS.PARTIAL_SUCCESS && result.partial_results) {
      const partialMsg = generatePartialSuccessMessage(
        actionName,
        result.partial_results.succeeded,
        result.partial_results.failed
      );
      result.messages.user = partialMsg.summary;
      result.messages.partial_details = partialMsg.details;
    }

    // Add retry message if applicable
    if (result.retry.should_retry) {
      result.messages.retry = generateRetryMessage(result.retry);
    }

    return result;
  }

  /**
   * Check if raw response indicates success
   */
  _checkRawSuccess(response, actionName) {
    if (!response) return false;

    // Explicit success flags
    if (response.successful === true) return true;
    if (response.successful === false) return false;
    if (response.success === true) return true;
    if (response.success === false) return false;
    if (response.ok === true) return true;
    if (response.ok === false) return false;

    // Error indicators
    if (response.error) return false;
    if (response.errors && response.errors.length > 0) return false;

    // Check for data presence (usually indicates success)
    if (response.data !== undefined && response.data !== null) {
      // But check if data contains an error
      if (response.data.error) return false;
      return true;
    }

    // Check for common success response patterns
    if (response.id || response.eventId || response.messageId) return true;
    if (response.items && Array.isArray(response.items)) return true;
    if (response.result) return true;

    // If no clear indicator, check HTTP-style status
    if (response.status >= 200 && response.status < 300) return true;
    if (response.statusCode >= 200 && response.statusCode < 300) return true;

    // Default to false for ambiguous responses
    return false;
  }

  /**
   * Detect success sub-status based on action and response
   */
  _detectSuccessSubStatus(actionName, response) {
    const action = actionName.toUpperCase();

    if (action.includes('CREATE') || action.includes('SEND')) {
      if (action.includes('DRAFT')) return SUB_STATUS.CREATED;
      if (action.includes('EMAIL') || action.includes('MESSAGE')) return SUB_STATUS.SENT;
      return SUB_STATUS.CREATED;
    }
    if (action.includes('UPDATE') || action.includes('EDIT')) {
      return SUB_STATUS.UPDATED;
    }
    if (action.includes('DELETE') || action.includes('REMOVE')) {
      return SUB_STATUS.DELETED;
    }
    if (action.includes('LIST') || action.includes('FETCH') || action.includes('FIND') || action.includes('GET')) {
      return SUB_STATUS.LISTED;
    }

    return null;
  }

  /**
   * Detect partial success for specific action types
   */
  _detectPartialSuccess(actionName, response, params) {
    // Check custom detectors first
    if (this.customPartialDetectors[actionName]) {
      return this.customPartialDetectors[actionName](response, params);
    }

    // Built-in partial success detection
    return detectPartialSuccess(actionName, response, params);
  }

  /**
   * Extract relevant data from response
   */
  _extractData(actionName, response) {
    // Check custom extractors first
    if (this.customExtractors[actionName]) {
      return this.customExtractors[actionName](response);
    }

    // Built-in extractors
    return extractActionData(actionName, response);
  }

  /**
   * Extract resource ID from response
   */
  _extractResourceId(actionName, response) {
    if (!response) return null;

    // Common ID fields
    const idFields = ['id', 'eventId', 'messageId', 'threadId', 'key', 'issue_key', 'ts', 'channel'];

    // Check response directly
    for (const field of idFields) {
      if (response[field]) return response[field];
    }

    // Check nested data
    if (response.data) {
      for (const field of idFields) {
        if (response.data[field]) return response.data[field];
      }
    }

    // Check result
    if (response.result) {
      for (const field of idFields) {
        if (response.result[field]) return response.result[field];
      }
    }

    return null;
  }

  /**
   * Determine retry strategy based on failure type
   */
  _determineRetryStrategy(status, subStatus, currentAttempt, response) {
    // Get strategy for this sub-status
    let strategy = this.retryStrategies[subStatus] || this.retryStrategies.default;

    // Check if we should retry
    if (strategy.should_retry === false) {
      return {
        should_retry: false,
        attempt: currentAttempt,
        max_attempts: strategy.max_attempts,
        delay_ms: 0,
        strategy: subStatus || 'none',
        wait_until_reset: strategy.wait_until_reset || false,
      };
    }

    // Check if max attempts reached
    if (currentAttempt >= strategy.max_attempts) {
      return {
        should_retry: false,
        attempt: currentAttempt,
        max_attempts: strategy.max_attempts,
        delay_ms: 0,
        strategy: subStatus || 'default',
        reason: 'max_attempts_reached',
      };
    }

    // Calculate delay with exponential backoff
    let delay = strategy.base_delay_ms * Math.pow(strategy.backoff_multiplier, currentAttempt);
    delay = Math.min(delay, strategy.max_delay_ms);

    // Add jitter if configured
    if (strategy.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    // Check for Retry-After header
    const retryAfter = this._extractRetryAfter(response);
    if (retryAfter) {
      delay = Math.max(delay, retryAfter);
    }

    return {
      should_retry: true,
      attempt: currentAttempt + 1,
      max_attempts: strategy.max_attempts,
      delay_ms: Math.round(delay),
      strategy: subStatus || 'default',
    };
  }

  /**
   * Extract Retry-After value from response (in milliseconds)
   */
  _extractRetryAfter(response) {
    if (!response) return null;

    // Check headers
    const retryAfter = response.headers?.['retry-after'] ||
                       response.retryAfter ||
                       response.retry_after;

    if (!retryAfter) return null;

    // Could be seconds (number) or HTTP date
    if (typeof retryAfter === 'number') {
      return retryAfter * 1000;
    }

    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }

    // Try parsing as date
    try {
      const date = new Date(retryAfter);
      const now = new Date();
      return Math.max(0, date.getTime() - now.getTime());
    } catch {
      return null;
    }
  }

  /**
   * Utility method to check if result needs user action
   */
  needsUserAction(result) {
    return isUserFixable(result.status) ||
           needsReconnection(result.status, result.sub_status);
  }

  /**
   * Utility method to get reconnection URL for permission failures
   */
  getReconnectionInfo(result) {
    if (!needsReconnection(result.status, result.sub_status)) {
      return null;
    }

    return {
      provider: result.metadata.provider,
      reason: result.sub_status === SUB_STATUS.TOKEN_EXPIRED
        ? 'token_expired'
        : 'missing_scope',
      message: result.messages.user,
    };
  }
}

// =============================================================================
// PARTIAL SUCCESS DETECTION
// =============================================================================

/**
 * Built-in partial success detection for common actions
 */
function detectPartialSuccess(actionName, response, params) {
  const action = actionName.toUpperCase();
  const result = { isPartial: false, sub_status: null, details: null };

  // Gmail send - check for failed recipients
  if (action === 'GMAIL_SEND_EMAIL' || action.includes('SEND_EMAIL')) {
    const failedRecipients = response.failedRecipients ||
                             response.data?.failedRecipients ||
                             response.failed_recipients;

    if (failedRecipients && failedRecipients.length > 0) {
      const allRecipients = params.to || params.recipients || [];
      const totalRecipients = Array.isArray(allRecipients) ? allRecipients.length : 1;

      result.isPartial = true;
      result.sub_status = SUB_STATUS.SOME_RECIPIENTS_FAILED;
      result.details = {
        total: totalRecipients,
        succeeded: totalRecipients - failedRecipients.length,
        failed: failedRecipients,
      };
    }
  }

  // Calendar event - check for failed attendees
  if (action.includes('CALENDAR') && action.includes('CREATE')) {
    const attendeeErrors = response.attendeeErrors ||
                           response.data?.attendeeErrors ||
                           response.attendees_not_added;

    if (attendeeErrors && attendeeErrors.length > 0) {
      const allAttendees = params.attendees || [];
      const totalAttendees = Array.isArray(allAttendees) ? allAttendees.length : 0;

      result.isPartial = true;
      result.sub_status = SUB_STATUS.SOME_ATTENDEES_FAILED;
      result.details = {
        total: totalAttendees,
        succeeded: totalAttendees - attendeeErrors.length,
        failed: attendeeErrors,
      };
    }

    // Check if notifications failed
    if (response.notificationsFailed || response.data?.notificationsFailed) {
      result.isPartial = true;
      result.sub_status = SUB_STATUS.CREATED_WITHOUT_NOTIFICATIONS;
      result.details = {
        notifications_sent: false,
        reason: 'notification_delivery_failed',
      };
    }
  }

  // Jira update - check for partially updated fields
  if (action.includes('JIRA') && action.includes('UPDATE')) {
    const fieldErrors = response.fieldErrors ||
                        response.data?.errors ||
                        response.update_failures;

    if (fieldErrors && Object.keys(fieldErrors).length > 0) {
      const attemptedFields = params.fields ? Object.keys(params.fields) : [];

      result.isPartial = true;
      result.sub_status = SUB_STATUS.PARTIAL_UPDATE;
      result.details = {
        total: attemptedFields.length,
        succeeded: attemptedFields.filter(f => !fieldErrors[f]),
        failed: Object.entries(fieldErrors).map(([field, error]) => ({
          field,
          reason: error,
        })),
      };
    }
  }

  // Slack message - check for partial delivery
  if (action.includes('SLACK') && action.includes('MESSAGE')) {
    if (response.warning || response.response_metadata?.warnings) {
      result.isPartial = true;
      result.sub_status = SUB_STATUS.PARTIAL_UPDATE;
      result.details = {
        warnings: response.warning || response.response_metadata?.warnings,
      };
    }
  }

  return result;
}

// =============================================================================
// DATA EXTRACTION
// =============================================================================

/**
 * Extract relevant data from response based on action type
 */
function extractActionData(actionName, response) {
  if (!response) return null;

  const action = actionName.toUpperCase();
  const data = response.data || response;

  // Calendar events
  if (action.includes('CALENDAR')) {
    if (action.includes('CREATE') || action.includes('UPDATE') || action.includes('GET')) {
      return {
        event_id: data.id || data.eventId,
        title: data.summary || data.title,
        start_datetime: data.start?.dateTime || data.start_datetime,
        end_datetime: data.end?.dateTime || data.end_datetime,
        attendees: data.attendees?.map(a => a.email) || [],
        location: data.location,
        link: data.htmlLink || data.hangoutLink,
      };
    }
    if (action.includes('LIST') || action.includes('FIND')) {
      const items = data.items || data.events || data;
      return {
        count: Array.isArray(items) ? items.length : 0,
        events: Array.isArray(items) ? items.map(e => ({
          event_id: e.id,
          title: e.summary,
          start_datetime: e.start?.dateTime || e.start?.date,
          end_datetime: e.end?.dateTime || e.end?.date,
        })) : [],
      };
    }
    if (action.includes('FREE_SLOTS')) {
      const slots = data.slots || data.freeSlots || data;
      return {
        count: Array.isArray(slots) ? slots.length : 0,
        slots: Array.isArray(slots) ? slots : [],
      };
    }
  }

  // Gmail
  if (action.includes('GMAIL') || action.includes('EMAIL')) {
    if (action.includes('SEND')) {
      return {
        message_id: data.id || data.messageId,
        thread_id: data.threadId,
        recipients: data.to || data.recipients,
      };
    }
    if (action.includes('DRAFT')) {
      return {
        draft_id: data.id || data.draftId,
        message_id: data.message?.id,
      };
    }
    if (action.includes('FETCH') || action.includes('LIST')) {
      const messages = data.messages || data.emails || data;
      return {
        count: Array.isArray(messages) ? messages.length : 0,
        messages: Array.isArray(messages) ? messages.slice(0, 10).map(m => ({
          id: m.id,
          subject: m.subject || m.payload?.headers?.find(h => h.name === 'Subject')?.value,
          from: m.from || m.payload?.headers?.find(h => h.name === 'From')?.value,
        })) : [],
      };
    }
    if (action.includes('GET')) {
      return {
        message_id: data.id,
        subject: data.subject || data.payload?.headers?.find(h => h.name === 'Subject')?.value,
        from: data.from || data.payload?.headers?.find(h => h.name === 'From')?.value,
        body: data.body || data.snippet,
      };
    }
  }

  // Slack
  if (action.includes('SLACK')) {
    if (action.includes('MESSAGE')) {
      return {
        ts: data.ts,
        channel: data.channel,
        permalink: data.permalink,
      };
    }
  }

  // Jira
  if (action.includes('JIRA')) {
    if (action.includes('CREATE') || action.includes('GET') || action.includes('UPDATE')) {
      return {
        key: data.key || data.issue_key,
        id: data.id,
        summary: data.fields?.summary || data.summary,
        status: data.fields?.status?.name || data.status,
        assignee: data.fields?.assignee?.displayName || data.assignee,
        link: data.self ? `${data.self.split('/rest')[0]}/browse/${data.key}` : null,
      };
    }
  }

  // Generic extraction
  return {
    id: data.id,
    ...data,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ResultNormalizer,
  RETRY_STRATEGIES,

  // Helper functions
  createNormalizedResult,
  detectPartialSuccess,
  extractActionData,

  // Re-export from StatusMappings for convenience
  NORMALIZED_STATUS,
  SUB_STATUS,
  isRetryable,
  isSuccess,
  isUserFixable,
  needsReconnection,
};
