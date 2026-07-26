/**
 * StatusMappings.js
 *
 * Unified status classification for normalizing provider responses.
 * Maps HTTP codes, provider error codes, and error patterns to internal statuses.
 */

// =============================================================================
// INTERNAL STATUS DEFINITIONS
// =============================================================================

const NORMALIZED_STATUS = {
  SUCCESS: 'SUCCESS',
  PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
  RETRYABLE_FAILURE: 'RETRYABLE_FAILURE',
  PERMISSION_FAILURE: 'PERMISSION_FAILURE',
  VALIDATION_FAILURE: 'VALIDATION_FAILURE',
  QUOTA_FAILURE: 'QUOTA_FAILURE',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNKNOWN_FAILURE: 'UNKNOWN_FAILURE',
};

// Sub-statuses for more granular classification
const SUB_STATUS = {
  // Success sub-statuses
  CREATED: 'created',
  UPDATED: 'updated',
  DELETED: 'deleted',
  LISTED: 'listed',
  SENT: 'sent',

  // Partial success sub-statuses
  SOME_RECIPIENTS_FAILED: 'some_recipients_failed',
  SOME_ATTENDEES_FAILED: 'some_attendees_failed',
  CREATED_WITHOUT_NOTIFICATIONS: 'created_without_notifications',
  PARTIAL_UPDATE: 'partial_update',

  // Retryable sub-statuses
  RATE_LIMITED: 'rate_limited',
  TIMEOUT: 'timeout',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  NETWORK_ERROR: 'network_error',
  TEMPORARY_ERROR: 'temporary_error',

  // Permission sub-statuses
  TOKEN_EXPIRED: 'token_expired',
  INSUFFICIENT_SCOPE: 'insufficient_scope',
  ACCESS_DENIED: 'access_denied',
  CALENDAR_ACCESS_DENIED: 'calendar_access_denied',

  // Validation sub-statuses
  INVALID_DATE: 'invalid_date',
  INVALID_EMAIL: 'invalid_email',
  MISSING_REQUIRED_FIELD: 'missing_required_field',
  INVALID_FORMAT: 'invalid_format',

  // Quota sub-statuses
  DAILY_LIMIT: 'daily_limit',
  USER_RATE_LIMIT: 'user_rate_limit',
  STORAGE_FULL: 'storage_full',

  // Not found sub-statuses
  EVENT_NOT_FOUND: 'event_not_found',
  CALENDAR_NOT_FOUND: 'calendar_not_found',
  EMAIL_NOT_FOUND: 'email_not_found',
  USER_NOT_FOUND: 'user_not_found',
  CHANNEL_NOT_FOUND: 'channel_not_found',
  TICKET_NOT_FOUND: 'ticket_not_found',

  // Conflict sub-statuses
  ALREADY_EXISTS: 'already_exists',
  VERSION_CONFLICT: 'version_conflict',
  CONCURRENT_MODIFICATION: 'concurrent_modification',
};

// =============================================================================
// HTTP STATUS CODE MAPPINGS
// =============================================================================

const HTTP_STATUS_MAP = {
  // 2xx Success
  200: { status: NORMALIZED_STATUS.SUCCESS, sub_status: null },
  201: { status: NORMALIZED_STATUS.SUCCESS, sub_status: SUB_STATUS.CREATED },
  202: { status: NORMALIZED_STATUS.SUCCESS, sub_status: null }, // Accepted
  204: { status: NORMALIZED_STATUS.SUCCESS, sub_status: SUB_STATUS.DELETED },

  // 4xx Client Errors
  400: { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  401: { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.TOKEN_EXPIRED },
  403: { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  404: { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: null },
  409: { status: NORMALIZED_STATUS.CONFLICT, sub_status: SUB_STATUS.ALREADY_EXISTS },
  410: { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: null }, // Gone
  422: { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  429: { status: NORMALIZED_STATUS.QUOTA_FAILURE, sub_status: SUB_STATUS.RATE_LIMITED },

  // 5xx Server Errors (all retryable)
  500: { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TEMPORARY_ERROR },
  502: { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.SERVICE_UNAVAILABLE },
  503: { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.SERVICE_UNAVAILABLE },
  504: { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TIMEOUT },
};

// =============================================================================
// PROVIDER-SPECIFIC ERROR CODE MAPPINGS
// =============================================================================

const GOOGLE_ERROR_CODES = {
  // Calendar API errors
  'notFound': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.EVENT_NOT_FOUND },
  'deleted': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.EVENT_NOT_FOUND },
  'gone': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.EVENT_NOT_FOUND },
  'calendarNotFound': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.CALENDAR_NOT_FOUND },
  'required': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.MISSING_REQUIRED_FIELD },
  'invalid': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  'invalidDate': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_DATE },
  'timeRangeEmpty': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_DATE },
  'quotaExceeded': { status: NORMALIZED_STATUS.QUOTA_FAILURE, sub_status: SUB_STATUS.DAILY_LIMIT },
  'userRateLimitExceeded': { status: NORMALIZED_STATUS.QUOTA_FAILURE, sub_status: SUB_STATUS.USER_RATE_LIMIT },
  'rateLimitExceeded': { status: NORMALIZED_STATUS.QUOTA_FAILURE, sub_status: SUB_STATUS.RATE_LIMITED },
  'dailyLimitExceeded': { status: NORMALIZED_STATUS.QUOTA_FAILURE, sub_status: SUB_STATUS.DAILY_LIMIT },
  'forbidden': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'insufficientPermissions': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'authError': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.TOKEN_EXPIRED },
  'unauthorized': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.TOKEN_EXPIRED },
  'backendError': { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TEMPORARY_ERROR },
  'internalError': { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TEMPORARY_ERROR },
  'conflict': { status: NORMALIZED_STATUS.CONFLICT, sub_status: SUB_STATUS.VERSION_CONFLICT },
  'duplicate': { status: NORMALIZED_STATUS.CONFLICT, sub_status: SUB_STATUS.ALREADY_EXISTS },

  // Gmail-specific
  'messageNotFound': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.EMAIL_NOT_FOUND },
  'labelNotFound': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: null },
  'invalidArgument': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  'failedPrecondition': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: null },
};

const MICROSOFT_ERROR_CODES = {
  // Graph API / Outlook errors
  'ErrorItemNotFound': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.EVENT_NOT_FOUND },
  'ErrorCalendarNotFound': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.CALENDAR_NOT_FOUND },
  'ErrorMailboxNotFound': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: null },
  'ErrorInvalidIdMalformed': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  'ErrorInvalidRequest': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  'ErrorAccessDenied': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'ErrorInsufficientPermissions': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.INSUFFICIENT_SCOPE },
  'ErrorTokenExpired': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.TOKEN_EXPIRED },
  'ErrorThrottled': { status: NORMALIZED_STATUS.QUOTA_FAILURE, sub_status: SUB_STATUS.RATE_LIMITED },
  'ErrorQuotaExceeded': { status: NORMALIZED_STATUS.QUOTA_FAILURE, sub_status: SUB_STATUS.DAILY_LIMIT },
  'ErrorServiceUnavailable': { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.SERVICE_UNAVAILABLE },
  'ErrorTimeout': { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TIMEOUT },
  'ErrorResourceModified': { status: NORMALIZED_STATUS.CONFLICT, sub_status: SUB_STATUS.CONCURRENT_MODIFICATION },
};

const SLACK_ERROR_CODES = {
  // Slack API errors
  'channel_not_found': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.CHANNEL_NOT_FOUND },
  'user_not_found': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.USER_NOT_FOUND },
  'message_not_found': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: null },
  'not_in_channel': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'is_archived': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'channel_is_archived': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'restricted_action': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'missing_scope': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.INSUFFICIENT_SCOPE },
  'token_revoked': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.TOKEN_EXPIRED },
  'invalid_auth': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.TOKEN_EXPIRED },
  'account_inactive': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'invalid_arguments': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  'invalid_name': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  'no_text': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.MISSING_REQUIRED_FIELD },
  'msg_too_long': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  'ratelimited': { status: NORMALIZED_STATUS.QUOTA_FAILURE, sub_status: SUB_STATUS.RATE_LIMITED },
  'request_timeout': { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TIMEOUT },
  'service_unavailable': { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.SERVICE_UNAVAILABLE },
  'fatal_error': { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TEMPORARY_ERROR },
  'name_taken': { status: NORMALIZED_STATUS.CONFLICT, sub_status: SUB_STATUS.ALREADY_EXISTS },
};

const JIRA_ERROR_CODES = {
  // Jira API errors
  'ISSUE_NOT_FOUND': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.TICKET_NOT_FOUND },
  'Issue Does Not Exist': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.TICKET_NOT_FOUND },
  'PROJECT_NOT_FOUND': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: null },
  'USER_NOT_FOUND': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: SUB_STATUS.USER_NOT_FOUND },
  'FIELD_NOT_FOUND': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  'INVALID_FIELD_VALUE': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  'INVALID_INPUT': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  'REQUIRED_FIELD_MISSING': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.MISSING_REQUIRED_FIELD },
  'NO_PERMISSION': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'BROWSE_PERMISSION_DENIED': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'EDIT_PERMISSION_DENIED': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'NOT_AUTHORIZED': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.TOKEN_EXPIRED },
  'RATE_LIMITED': { status: NORMALIZED_STATUS.QUOTA_FAILURE, sub_status: SUB_STATUS.RATE_LIMITED },
  'SERVICE_ERROR': { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TEMPORARY_ERROR },
  'INTERNAL_SERVER_ERROR': { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TEMPORARY_ERROR },
  'CONFLICT': { status: NORMALIZED_STATUS.CONFLICT, sub_status: SUB_STATUS.CONCURRENT_MODIFICATION },
};

const COMPOSIO_ERROR_CODES = {
  // Composio platform errors
  'TOOL_NOT_FOUND': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: null },
  'APP_NOT_CONNECTED': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.ACCESS_DENIED },
  'ENTITY_NOT_FOUND': { status: NORMALIZED_STATUS.NOT_FOUND, sub_status: null },
  'CONNECTION_NOT_FOUND': { status: NORMALIZED_STATUS.PERMISSION_FAILURE, sub_status: SUB_STATUS.TOKEN_EXPIRED },
  'INVALID_PARAMS': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.INVALID_FORMAT },
  'MISSING_REQUIRED_PARAMS': { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: SUB_STATUS.MISSING_REQUIRED_FIELD },
  'RATE_LIMIT_EXCEEDED': { status: NORMALIZED_STATUS.QUOTA_FAILURE, sub_status: SUB_STATUS.RATE_LIMITED },
  'EXECUTION_TIMEOUT': { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TIMEOUT },
  'EXECUTION_FAILED': { status: NORMALIZED_STATUS.UNKNOWN_FAILURE, sub_status: null },
  'PROVIDER_ERROR': { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TEMPORARY_ERROR },
};

// Combined provider map for easy lookup
const PROVIDER_ERROR_MAPS = {
  google: GOOGLE_ERROR_CODES,
  microsoft: MICROSOFT_ERROR_CODES,
  slack: SLACK_ERROR_CODES,
  jira: JIRA_ERROR_CODES,
  composio: COMPOSIO_ERROR_CODES,
};

// =============================================================================
// ERROR PATTERN DETECTION
// =============================================================================

const ERROR_PATTERNS = [
  // Network errors (retryable)
  {
    pattern: /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|connection refused/i,
    status: NORMALIZED_STATUS.RETRYABLE_FAILURE,
    sub_status: SUB_STATUS.NETWORK_ERROR,
  },
  {
    pattern: /timeout|timed out|deadline exceeded/i,
    status: NORMALIZED_STATUS.RETRYABLE_FAILURE,
    sub_status: SUB_STATUS.TIMEOUT,
  },
  {
    pattern: /socket hang up|network error|fetch failed/i,
    status: NORMALIZED_STATUS.RETRYABLE_FAILURE,
    sub_status: SUB_STATUS.NETWORK_ERROR,
  },

  // Rate limiting / quota
  {
    pattern: /rate limit|too many requests|quota exceeded|limit exceeded/i,
    status: NORMALIZED_STATUS.QUOTA_FAILURE,
    sub_status: SUB_STATUS.RATE_LIMITED,
  },
  {
    pattern: /daily limit|usage limit/i,
    status: NORMALIZED_STATUS.QUOTA_FAILURE,
    sub_status: SUB_STATUS.DAILY_LIMIT,
  },

  // Authentication / Permission
  {
    pattern: /token expired|token invalid|authentication required|unauthorized/i,
    status: NORMALIZED_STATUS.PERMISSION_FAILURE,
    sub_status: SUB_STATUS.TOKEN_EXPIRED,
  },
  {
    pattern: /access denied|permission denied|forbidden|insufficient permissions/i,
    status: NORMALIZED_STATUS.PERMISSION_FAILURE,
    sub_status: SUB_STATUS.ACCESS_DENIED,
  },
  {
    pattern: /missing scope|insufficient scope/i,
    status: NORMALIZED_STATUS.PERMISSION_FAILURE,
    sub_status: SUB_STATUS.INSUFFICIENT_SCOPE,
  },

  // Not found
  {
    pattern: /not found|does not exist|no such|404/i,
    status: NORMALIZED_STATUS.NOT_FOUND,
    sub_status: null,
  },
  {
    pattern: /event not found|calendar not found/i,
    status: NORMALIZED_STATUS.NOT_FOUND,
    sub_status: SUB_STATUS.EVENT_NOT_FOUND,
  },

  // Validation
  {
    pattern: /invalid date|invalid time|date format|time format/i,
    status: NORMALIZED_STATUS.VALIDATION_FAILURE,
    sub_status: SUB_STATUS.INVALID_DATE,
  },
  {
    pattern: /invalid email|email format|malformed email/i,
    status: NORMALIZED_STATUS.VALIDATION_FAILURE,
    sub_status: SUB_STATUS.INVALID_EMAIL,
  },
  {
    pattern: /required field|missing required|is required/i,
    status: NORMALIZED_STATUS.VALIDATION_FAILURE,
    sub_status: SUB_STATUS.MISSING_REQUIRED_FIELD,
  },
  {
    pattern: /invalid|malformed|bad request|validation failed/i,
    status: NORMALIZED_STATUS.VALIDATION_FAILURE,
    sub_status: SUB_STATUS.INVALID_FORMAT,
  },

  // Conflict
  {
    pattern: /already exists|duplicate|conflict/i,
    status: NORMALIZED_STATUS.CONFLICT,
    sub_status: SUB_STATUS.ALREADY_EXISTS,
  },
  {
    pattern: /version mismatch|concurrent modification|etag/i,
    status: NORMALIZED_STATUS.CONFLICT,
    sub_status: SUB_STATUS.CONCURRENT_MODIFICATION,
  },

  // Server errors (retryable)
  {
    pattern: /internal server error|server error|5\d{2}/i,
    status: NORMALIZED_STATUS.RETRYABLE_FAILURE,
    sub_status: SUB_STATUS.TEMPORARY_ERROR,
  },
  {
    pattern: /service unavailable|temporarily unavailable|backend error/i,
    status: NORMALIZED_STATUS.RETRYABLE_FAILURE,
    sub_status: SUB_STATUS.SERVICE_UNAVAILABLE,
  },
];

// =============================================================================
// STATUS CLASSIFICATION FUNCTIONS
// =============================================================================

/**
 * Classify status from HTTP status code
 */
function classifyFromHttpStatus(statusCode) {
  const mapping = HTTP_STATUS_MAP[statusCode];
  if (mapping) {
    return { ...mapping, source: 'http_status' };
  }

  // Handle ranges
  if (statusCode >= 200 && statusCode < 300) {
    return { status: NORMALIZED_STATUS.SUCCESS, sub_status: null, source: 'http_status' };
  }
  if (statusCode >= 400 && statusCode < 500) {
    return { status: NORMALIZED_STATUS.VALIDATION_FAILURE, sub_status: null, source: 'http_status' };
  }
  if (statusCode >= 500) {
    return { status: NORMALIZED_STATUS.RETRYABLE_FAILURE, sub_status: SUB_STATUS.TEMPORARY_ERROR, source: 'http_status' };
  }

  return { status: NORMALIZED_STATUS.UNKNOWN_FAILURE, sub_status: null, source: 'http_status' };
}

/**
 * Classify status from provider-specific error code
 */
function classifyFromProviderCode(provider, errorCode) {
  const providerMap = PROVIDER_ERROR_MAPS[provider?.toLowerCase()];
  if (!providerMap) {
    return null;
  }

  const mapping = providerMap[errorCode];
  if (mapping) {
    return { ...mapping, source: 'provider_code', provider, error_code: errorCode };
  }

  return null;
}

/**
 * Classify status from error message patterns
 */
function classifyFromErrorMessage(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  for (const { pattern, status, sub_status } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return { status, sub_status, source: 'error_pattern', matched_pattern: pattern.source };
    }
  }

  return null;
}

/**
 * Detect provider from action name or response
 */
function detectProvider(actionName, response) {
  const actionLower = actionName?.toLowerCase() || '';

  if (actionLower.includes('google') || actionLower.includes('gmail')) {
    return 'google';
  }
  if (actionLower.includes('microsoft') || actionLower.includes('outlook')) {
    return 'microsoft';
  }
  if (actionLower.includes('slack')) {
    return 'slack';
  }
  if (actionLower.includes('jira') || actionLower.includes('atlassian')) {
    return 'jira';
  }
  if (actionLower.includes('composio')) {
    return 'composio';
  }

  // Try to detect from response structure
  if (response?.error?.code && typeof response.error.code === 'string') {
    if (response.error.code.startsWith('Error') && response.error.code.includes('Microsoft')) {
      return 'microsoft';
    }
  }

  return null;
}

/**
 * Extract error code from response
 */
function extractErrorCode(response) {
  if (!response) return null;

  // Direct error code
  if (response.error?.code) return response.error.code;
  if (response.error?.reason) return response.error.reason;
  if (response.error) return response.error;

  // Nested structures
  if (response.data?.error?.code) return response.data.error.code;
  if (response.data?.error?.reason) return response.data.error.reason;

  // Composio-style
  if (response.errorCode) return response.errorCode;

  // Slack-style
  if (response.ok === false && response.error) return response.error;

  return null;
}

/**
 * Extract error message from response
 */
function extractErrorMessage(response) {
  if (!response) return null;

  // Common patterns
  if (typeof response === 'string') return response;
  if (response.error?.message) return response.error.message;
  if (response.error?.description) return response.error.description;
  if (response.message) return response.message;
  if (response.error && typeof response.error === 'string') return response.error;

  // Nested
  if (response.data?.error?.message) return response.data.error.message;
  if (response.data?.message) return response.data.message;

  // Array of errors
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    return response.errors.map(e => e.message || e).join('; ');
  }

  return null;
}

/**
 * Main classification function - tries all methods in priority order
 */
function classifyStatus(actionName, response, httpStatus = null) {
  const provider = detectProvider(actionName, response);
  const errorCode = extractErrorCode(response);
  const errorMessage = extractErrorMessage(response);

  // Priority 1: Provider-specific error code (most accurate)
  if (provider && errorCode) {
    const providerResult = classifyFromProviderCode(provider, errorCode);
    if (providerResult) {
      return {
        ...providerResult,
        error_message: errorMessage,
      };
    }
  }

  // Priority 2: HTTP status code
  if (httpStatus) {
    const httpResult = classifyFromHttpStatus(httpStatus);
    if (httpResult.status !== NORMALIZED_STATUS.UNKNOWN_FAILURE) {
      return {
        ...httpResult,
        provider,
        error_code: errorCode,
        error_message: errorMessage,
      };
    }
  }

  // Priority 3: Error message pattern matching
  if (errorMessage) {
    const patternResult = classifyFromErrorMessage(errorMessage);
    if (patternResult) {
      return {
        ...patternResult,
        provider,
        error_code: errorCode,
        error_message: errorMessage,
      };
    }
  }

  // Fallback
  return {
    status: NORMALIZED_STATUS.UNKNOWN_FAILURE,
    sub_status: null,
    source: 'fallback',
    provider,
    error_code: errorCode,
    error_message: errorMessage,
  };
}

/**
 * Check if a status is retryable
 */
function isRetryable(status) {
  return status === NORMALIZED_STATUS.RETRYABLE_FAILURE ||
         status === NORMALIZED_STATUS.QUOTA_FAILURE;
}

/**
 * Check if a status indicates success (including partial)
 */
function isSuccess(status) {
  return status === NORMALIZED_STATUS.SUCCESS ||
         status === NORMALIZED_STATUS.PARTIAL_SUCCESS;
}

/**
 * Check if a status is a user-fixable error
 */
function isUserFixable(status) {
  return status === NORMALIZED_STATUS.VALIDATION_FAILURE ||
         status === NORMALIZED_STATUS.NOT_FOUND ||
         status === NORMALIZED_STATUS.CONFLICT;
}

/**
 * Check if reconnection might fix the error
 */
function needsReconnection(status, sub_status) {
  return status === NORMALIZED_STATUS.PERMISSION_FAILURE &&
         (sub_status === SUB_STATUS.TOKEN_EXPIRED ||
          sub_status === SUB_STATUS.INSUFFICIENT_SCOPE);
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Status enums
  NORMALIZED_STATUS,
  SUB_STATUS,

  // Raw mappings (for extension/customization)
  HTTP_STATUS_MAP,
  GOOGLE_ERROR_CODES,
  MICROSOFT_ERROR_CODES,
  SLACK_ERROR_CODES,
  JIRA_ERROR_CODES,
  COMPOSIO_ERROR_CODES,
  PROVIDER_ERROR_MAPS,
  ERROR_PATTERNS,

  // Classification functions
  classifyFromHttpStatus,
  classifyFromProviderCode,
  classifyFromErrorMessage,
  classifyStatus,

  // Helper functions
  detectProvider,
  extractErrorCode,
  extractErrorMessage,
  isRetryable,
  isSuccess,
  isUserFixable,
  needsReconnection,
};
