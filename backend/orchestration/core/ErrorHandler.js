/**
 * ErrorHandler - Production-grade error handling and user-friendly messaging
 *
 * Features:
 * - Error classification (auth, rate limit, validation, etc.)
 * - User-friendly error messages
 * - Error logging with context
 * - Error recovery suggestions
 */

// Error categories
const ErrorCategory = {
  AUTH: 'auth',
  RATE_LIMIT: 'rate_limit',
  PERMISSION: 'permission',
  NOT_FOUND: 'not_found',
  VALIDATION: 'validation',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  SERVICE: 'service',
  UNKNOWN: 'unknown',
};

// App-specific error patterns
const APP_ERROR_PATTERNS = {
  JIRA: {
    patterns: [
      { regex: /issue does not exist/i, category: ErrorCategory.NOT_FOUND, resource: 'issue' },
      { regex: /project does not exist/i, category: ErrorCategory.NOT_FOUND, resource: 'project' },
      { regex: /unauthorized|401/i, category: ErrorCategory.AUTH },
      { regex: /forbidden|403/i, category: ErrorCategory.PERMISSION },
      { regex: /rate limit|429/i, category: ErrorCategory.RATE_LIMIT },
    ],
  },
  SLACK: {
    patterns: [
      { regex: /channel_not_found/i, category: ErrorCategory.NOT_FOUND, resource: 'channel' },
      { regex: /user_not_found/i, category: ErrorCategory.NOT_FOUND, resource: 'user' },
      { regex: /invalid_auth|not_authed/i, category: ErrorCategory.AUTH },
      { regex: /rate_limited|ratelimit/i, category: ErrorCategory.RATE_LIMIT },
      { regex: /missing_scope/i, category: ErrorCategory.PERMISSION },
    ],
  },
  GMAIL: {
    patterns: [
      { regex: /message not found|404/i, category: ErrorCategory.NOT_FOUND, resource: 'email' },
      { regex: /invalid_grant|unauthorized|401/i, category: ErrorCategory.AUTH },
      { regex: /rate limit|429|quota/i, category: ErrorCategory.RATE_LIMIT },
      { regex: /forbidden|403/i, category: ErrorCategory.PERMISSION },
      { regex: /invalid.*recipient|invalid.*email/i, category: ErrorCategory.VALIDATION, field: 'to' },
    ],
  },
  GOOGLECALENDAR: {
    patterns: [
      { regex: /event not found|404/i, category: ErrorCategory.NOT_FOUND, resource: 'event' },
      { regex: /invalid_grant|unauthorized|401/i, category: ErrorCategory.AUTH },
      { regex: /rate limit|429|quota/i, category: ErrorCategory.RATE_LIMIT },
      { regex: /forbidden|403/i, category: ErrorCategory.PERMISSION },
      { regex: /invalid.*date|invalid.*time|unconverted data/i, category: ErrorCategory.VALIDATION, field: 'datetime' },
      { regex: /calendar.*not found/i, category: ErrorCategory.NOT_FOUND, resource: 'calendar' },
    ],
  },
  GITHUB: {
    patterns: [
      { regex: /not found|404/i, category: ErrorCategory.NOT_FOUND },
      { regex: /bad credentials|401/i, category: ErrorCategory.AUTH },
      { regex: /rate limit|403.*rate/i, category: ErrorCategory.RATE_LIMIT },
      { regex: /forbidden|403/i, category: ErrorCategory.PERMISSION },
    ],
  },
};

// Generic error patterns
const GENERIC_PATTERNS = [
  { regex: /unauthorized|401|invalid.*token|token.*expired/i, category: ErrorCategory.AUTH },
  { regex: /forbidden|403/i, category: ErrorCategory.PERMISSION },
  { regex: /not found|404/i, category: ErrorCategory.NOT_FOUND },
  { regex: /rate.*limit|429|too many requests/i, category: ErrorCategory.RATE_LIMIT },
  { regex: /timeout|ETIMEDOUT|ECONNABORTED/i, category: ErrorCategory.TIMEOUT },
  { regex: /network|ECONNREFUSED|ENOTFOUND|ENETUNREACH/i, category: ErrorCategory.NETWORK },
  { regex: /500|internal.*error|service.*unavailable|503/i, category: ErrorCategory.SERVICE },
  { regex: /validation|invalid|required|missing/i, category: ErrorCategory.VALIDATION },
];

class ErrorHandler {
  constructor() {
    this.errorLog = [];
    this.maxLogSize = 1000;
  }

  /**
   * Classify an error and return structured information
   * @param {Error|Object} error - Error to classify
   * @param {string} app - App name (JIRA, SLACK, etc.)
   * @returns {Object} Classified error with category, message, suggestions
   */
  classify(error, app = null) {
    const errorStr = this._extractErrorString(error);
    const statusCode = this._extractStatusCode(error);

    // Try app-specific patterns first
    if (app && APP_ERROR_PATTERNS[app.toUpperCase()]) {
      const appPatterns = APP_ERROR_PATTERNS[app.toUpperCase()].patterns;
      for (const pattern of appPatterns) {
        if (pattern.regex.test(errorStr)) {
          return {
            category: pattern.category,
            app,
            resource: pattern.resource,
            field: pattern.field,
            originalError: error,
            statusCode,
          };
        }
      }
    }

    // Try generic patterns
    for (const pattern of GENERIC_PATTERNS) {
      if (pattern.regex.test(errorStr)) {
        return {
          category: pattern.category,
          app,
          originalError: error,
          statusCode,
        };
      }
    }

    // Unknown error
    return {
      category: ErrorCategory.UNKNOWN,
      app,
      originalError: error,
      statusCode,
    };
  }

  /**
   * Get user-friendly error message
   * @param {Error|Object} error - Error to format
   * @param {string} app - App name
   * @param {string} action - Action being performed
   * @returns {Object} { message: string, suggestions: array }
   */
  toUserMessage(error, app = null, action = null) {
    const classified = this.classify(error, app);

    const messages = {
      [ErrorCategory.AUTH]: {
        message: `Your ${app || 'app'} connection has expired. Please reconnect it in settings.`,
        suggestions: [
          'Go to Settings > Integrations',
          `Reconnect your ${app || 'app'} account`,
          'Try again after reconnecting',
        ],
      },
      [ErrorCategory.RATE_LIMIT]: {
        message: `${app || 'The service'} is temporarily rate-limited. Please wait a moment and try again.`,
        suggestions: [
          'Wait 30-60 seconds before retrying',
          'Reduce the frequency of requests',
          'Try breaking down into smaller operations',
        ],
      },
      [ErrorCategory.PERMISSION]: {
        message: `I don't have permission to do that in ${app || 'this app'}.`,
        suggestions: [
          'Check your account permissions',
          'Ask an admin to grant access',
          `Reconnect ${app || 'the app'} with additional permissions`,
        ],
      },
      [ErrorCategory.NOT_FOUND]: {
        message: this._getNotFoundMessage(classified),
        suggestions: [
          'Double-check the name or ID',
          'Make sure it exists and you have access',
          'Try searching for it first',
        ],
      },
      [ErrorCategory.VALIDATION]: {
        message: this._getValidationMessage(classified, error),
        suggestions: [
          'Check the format of your input',
          'Make sure all required fields are filled',
          'Try providing more specific information',
        ],
      },
      [ErrorCategory.TIMEOUT]: {
        message: 'The request timed out. The service might be slow or unavailable.',
        suggestions: [
          'Try again in a few seconds',
          'Check your internet connection',
          'The service might be experiencing issues',
        ],
      },
      [ErrorCategory.NETWORK]: {
        message: 'Network error - could not connect to the service.',
        suggestions: [
          'Check your internet connection',
          'The service might be down',
          'Try again in a few moments',
        ],
      },
      [ErrorCategory.SERVICE]: {
        message: `${app || 'The service'} is experiencing issues. Please try again later.`,
        suggestions: [
          'This is usually temporary',
          'Wait a few minutes and try again',
          'Check the service status page',
        ],
      },
      [ErrorCategory.UNKNOWN]: {
        message: this._getGenericMessage(error, action),
        suggestions: [
          'Try rephrasing your request',
          'Make sure all information is correct',
          'Contact support if the problem persists',
        ],
      },
    };

    const result = messages[classified.category] || messages[ErrorCategory.UNKNOWN];

    // Log the error
    this._logError(error, classified, app, action);

    return result;
  }

  /**
   * Get not found specific message
   */
  _getNotFoundMessage(classified) {
    const resourceMessages = {
      issue: "I couldn't find that Jira issue. Please check the issue key.",
      project: "I couldn't find that project. Please check the project key.",
      channel: "I couldn't find that Slack channel. Please check the channel name.",
      user: "I couldn't find that user. Please check the username.",
      email: "I couldn't find that email. It may have been deleted.",
      event: "I couldn't find that calendar event. Please check the event details.",
      calendar: "I couldn't find that calendar. Please check the calendar name.",
    };

    if (classified.resource && resourceMessages[classified.resource]) {
      return resourceMessages[classified.resource];
    }

    return `I couldn't find what you mentioned. Please double-check and try again.`;
  }

  /**
   * Get validation specific message
   */
  _getValidationMessage(classified, error) {
    const errorStr = this._extractErrorString(error);

    if (classified.field === 'datetime' || /date|time/i.test(errorStr)) {
      return 'The date/time format is invalid. Please use a format like "tomorrow at 3pm" or "2025-12-15 15:00".';
    }

    if (classified.field === 'to' || /email|recipient/i.test(errorStr)) {
      return 'The email address appears to be invalid. Please check and try again.';
    }

    if (/required|missing/i.test(errorStr)) {
      return 'Some required information is missing. Please provide all the necessary details.';
    }

    return 'There was an issue with the provided information. Please check your input and try again.';
  }

  /**
   * Get generic error message
   */
  _getGenericMessage(error, action) {
    const errorStr = this._extractErrorString(error);

    // Try to extract something useful
    if (errorStr.length < 200 && errorStr.length > 10) {
      return `Something went wrong: ${errorStr.slice(0, 150)}`;
    }

    if (action) {
      return `I couldn't complete the ${action.toLowerCase().replace(/_/g, ' ')}. Please try again.`;
    }

    return "Something went wrong. Please try again or rephrase your request.";
  }

  /**
   * Extract error string from various error formats
   */
  _extractErrorString(error) {
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    if (error.error) return typeof error.error === 'string' ? error.error : JSON.stringify(error.error);
    if (error.data?.error) return error.data.error;
    if (error.response?.data?.message) return error.response.data.message;
    return JSON.stringify(error);
  }

  /**
   * Extract status code from error
   */
  _extractStatusCode(error) {
    return error.status || error.statusCode || error.response?.status || null;
  }

  /**
   * Log error for debugging
   */
  _logError(error, classified, app, action) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      category: classified.category,
      app,
      action,
      statusCode: classified.statusCode,
      message: this._extractErrorString(error),
    };

    this.errorLog.push(logEntry);

    // Keep log size bounded
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift();
    }

    // Console log for debugging
    console.error(`[ErrorHandler] ${classified.category}: ${logEntry.message.slice(0, 200)}`);
  }

  /**
   * Get recent errors for debugging
   */
  getRecentErrors(count = 10) {
    return this.errorLog.slice(-count);
  }

  /**
   * Create a structured error
   */
  createError(category, message, details = {}) {
    const error = new Error(message);
    error.category = category;
    error.code = category.toUpperCase();
    Object.assign(error, details);
    return error;
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error) {
    const classified = this.classify(error);
    return [ErrorCategory.RATE_LIMIT, ErrorCategory.TIMEOUT, ErrorCategory.NETWORK, ErrorCategory.SERVICE].includes(classified.category);
  }
}

module.exports = { ErrorHandler, ErrorCategory };
