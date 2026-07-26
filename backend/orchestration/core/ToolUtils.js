/**
 * ToolUtils - Shared utilities for tool execution
 *
 * Contains:
 * - isToolSuccess() - Unified success checking for Composio responses
 * - normalizeDateTime() - Convert natural language dates to ISO format (legacy)
 * - normalizeDateTimeAdvanced() - Full temporal resolution with ambiguity handling
 * - normalizeParams() - Normalize all datetime fields in params object
 */

const { TemporalResolver } = require('./TemporalResolver');

/**
 * Check if a tool execution was successful
 * Composio returns { successful: boolean, data: ... } but our code sometimes checks { success: boolean }
 * This function handles both cases correctly.
 *
 * @param {Object} result - The tool execution result
 * @returns {boolean} True if the tool execution was successful
 */
function isToolSuccess(result) {
  if (!result) return false;

  // Check Composio's 'successful' field first (primary)
  if (result.successful === false) {
    return false;
  }

  // Check for explicit error field
  if (result.error) {
    return false;
  }

  // Check our internal 'success' field
  if (result.success === false) {
    return false;
  }

  // Check for error in data
  if (result.data && result.data.error) {
    return false;
  }

  // Check for HTTP error status codes
  if (result.status && result.status >= 400) {
    return false;
  }

  // If successful is explicitly true, we're good
  if (result.successful === true) {
    return true;
  }

  // Default: assume success if no error indicators
  return true;
}

/**
 * Get error message from a tool result
 * @param {Object} result - The tool execution result
 * @returns {string|null} Error message or null if successful
 */
function getToolError(result) {
  if (!result) return 'No result returned';

  if (result.error) {
    return typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
  }

  if (result.data && result.data.error) {
    return typeof result.data.error === 'string' ? result.data.error : JSON.stringify(result.data.error);
  }

  if (result.successful === false) {
    return result.message || result.data?.message || 'Tool execution failed';
  }

  return null;
}

/**
 * Normalize a natural language datetime string to ISO format
 * Handles: "tmr at 5pm", "tomorrow 3pm", "5pm", "next monday 2pm", etc.
 *
 * @param {string} input - Natural language datetime string
 * @param {string} timezone - User timezone (default: America/Los_Angeles)
 * @returns {string|null} ISO format datetime or null if can't parse
 */
function normalizeDateTime(input, timezone = 'America/Los_Angeles') {
  if (!input || typeof input !== 'string') return null;

  const normalized = input.toLowerCase().trim();

  // Already ISO format - validate and return
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/.test(input)) {
    const date = new Date(input);
    if (!isNaN(date.getTime())) {
      // Ensure it has seconds and timezone
      if (!input.includes(':00Z') && !input.match(/[+-]\d{2}:\d{2}$/)) {
        return input.replace(/T(\d{2}:\d{2})$/, 'T$1:00Z');
      }
      return input;
    }
  }

  // Get current date in timezone
  const now = new Date();
  const options = { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' };
  const todayStr = now.toLocaleDateString('en-CA', options);

  let targetDate = new Date(`${todayStr}T12:00:00`);
  let hours = 12;
  let minutes = 0;
  let foundTime = false;

  // Parse day references
  if (/\b(tmr|tomorrow)\b/.test(normalized)) {
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (/\bday after (tomorrow|tmr)\b/.test(normalized)) {
    targetDate.setDate(targetDate.getDate() + 2);
  } else if (/\bnext week\b/.test(normalized)) {
    targetDate.setDate(targetDate.getDate() + 7);
  } else if (/\byesterday\b/.test(normalized)) {
    targetDate.setDate(targetDate.getDate() - 1);
  } else if (/\btoday\b/.test(normalized)) {
    // Keep today
  } else {
    // Check for day of week
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const nextDayMatch = normalized.match(/next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
    const thisDayMatch = normalized.match(/this\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
    const onDayMatch = normalized.match(/on\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);

    const dayMatch = nextDayMatch || thisDayMatch || onDayMatch;
    if (dayMatch) {
      const targetDayIndex = days.indexOf(dayMatch[1]);
      const currentDayIndex = targetDate.getDay();
      let daysToAdd = targetDayIndex - currentDayIndex;
      if (daysToAdd <= 0 || nextDayMatch) {
        daysToAdd += 7;
      }
      targetDate.setDate(targetDate.getDate() + daysToAdd);
    }
  }

  // Parse time - multiple patterns
  // Pattern 1: "5pm", "5:30pm", "5 pm"
  const time12Match = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  // Pattern 2: "17:00", "17:30"
  const time24Match = normalized.match(/(\d{2}):(\d{2})/);
  // Pattern 3: "at 5" (assumes pm if no meridiem and hour < 12)
  const timeAtMatch = normalized.match(/at\s+(\d{1,2})(?::(\d{2}))?(?!\s*(am|pm))/i);

  if (time12Match) {
    hours = parseInt(time12Match[1], 10);
    minutes = time12Match[2] ? parseInt(time12Match[2], 10) : 0;
    const meridiem = time12Match[3].toLowerCase();

    if (meridiem === 'pm' && hours < 12) {
      hours += 12;
    } else if (meridiem === 'am' && hours === 12) {
      hours = 0;
    }
    foundTime = true;
  } else if (time24Match) {
    hours = parseInt(time24Match[1], 10);
    minutes = parseInt(time24Match[2], 10);
    foundTime = true;
  } else if (timeAtMatch) {
    hours = parseInt(timeAtMatch[1], 10);
    minutes = timeAtMatch[2] ? parseInt(timeAtMatch[2], 10) : 0;
    // Assume PM for typical meeting hours
    if (hours < 12 && hours >= 1 && hours <= 6) {
      hours += 12;
    }
    foundTime = true;
  }

  // If we only got a day reference with no time, return null (incomplete)
  // Unless it's purely a time reference like "5pm"
  const hasDayRef = /\b(tmr|tomorrow|today|yesterday|next|this|on)\s+\w+|\bday after\b/i.test(normalized);
  if (!foundTime && hasDayRef) {
    // Return just the date part, no time specified
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`; // Date only
  }

  if (!foundTime) {
    return null; // Can't parse
  }

  // Build final ISO string
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const hourStr = String(hours).padStart(2, '0');
  const minuteStr = String(minutes).padStart(2, '0');

  return `${year}-${month}-${day}T${hourStr}:${minuteStr}:00Z`;
}

/**
 * Calculate end datetime from start + duration
 * @param {string} startISO - Start time in ISO format
 * @param {number} durationMinutes - Duration in minutes (default: 30)
 * @returns {string} End time in ISO format
 */
function calculateEndDateTime(startISO, durationMinutes = 30) {
  if (!startISO) return null;

  const start = new Date(startISO);
  if (isNaN(start.getTime())) return null;

  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return end.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Singleton TemporalResolver instance
let _temporalResolver = null;
function getTemporalResolver(options = {}) {
  if (!_temporalResolver) {
    _temporalResolver = new TemporalResolver(options);
  }
  return _temporalResolver;
}

/**
 * Advanced datetime normalization with full ambiguity handling
 *
 * This is the recommended function for new code. It provides:
 * - Timezone-aware resolution
 * - Ambiguity detection and risk scoring
 * - DST-safe storage (timezone identifier, not offset)
 * - Human-readable confirmations
 *
 * @param {string} input - Natural language datetime string
 * @param {Object} options - Resolution options
 * @param {string} options.timezone - User timezone (e.g., 'America/New_York')
 * @param {Date} options.referenceDate - Reference date for relative expressions
 * @param {Array} options.attendees - Meeting attendees (for multi-tz detection)
 * @param {boolean} options.hasExternalAttendees - Whether external people are involved
 * @param {boolean} options.isIrreversible - Whether the action is irreversible
 * @param {boolean} options.isWorkContext - Whether this is a work context
 * @returns {Object} Full resolution result with datetime, ambiguities, confirmation
 */
function normalizeDateTimeAdvanced(input, options = {}) {
  if (!input || typeof input !== 'string') {
    return {
      success: false,
      error: 'No input provided',
      iso: null,
    };
  }

  const resolver = getTemporalResolver({
    defaultTimezone: options.timezone || 'America/Los_Angeles',
    locale: options.locale || 'en-US',
  });

  const result = resolver.resolve(input, {
    userTimezone: options.timezone,
    deviceTimezone: options.deviceTimezone,
    referenceDate: options.referenceDate || new Date(),
    attendees: options.attendees,
    hasExternalAttendees: options.hasExternalAttendees,
    isIrreversible: options.isIrreversible,
    isWorkContext: options.isWorkContext !== false, // Default to work context
    originalInput: input,
  });

  // Add convenience ISO field for backwards compatibility
  if (result.success && result.resolved) {
    result.iso = result.resolved.utc;
    result.local_iso = result.resolved.local;
    result.timezone_used = result.resolved.timezone;
  }

  return result;
}

/**
 * Quick normalize with TemporalResolver - simple interface
 * Returns just the ISO string (or null) for backwards compatibility
 *
 * @param {string} input - Natural language datetime string
 * @param {string} timezone - User timezone
 * @returns {string|null} ISO format datetime or null
 */
function normalizeWithResolver(input, timezone = 'America/Los_Angeles') {
  const resolver = getTemporalResolver({ defaultTimezone: timezone });
  return resolver.quickNormalize(input, { timezone });
}

/**
 * Normalize all datetime fields in a params object
 * @param {Object} params - Parameters object
 * @param {string} timezone - User timezone
 * @returns {Object} Normalized parameters
 */
function normalizeParams(params, timezone = 'America/Los_Angeles') {
  if (!params || typeof params !== 'object') return params;

  const normalized = { ...params };
  const datetimeFields = [
    'start_datetime',
    'end_datetime',
    'datetime',
    'date',
    'start_time',
    'end_time',
    'timeMin',
    'timeMax',
    'due_date',
    'deadline',
    'scheduled_time',
  ];

  for (const field of datetimeFields) {
    if (normalized[field] && typeof normalized[field] === 'string') {
      const normalizedValue = normalizeDateTime(normalized[field], timezone);
      if (normalizedValue) {
        normalized[field] = normalizedValue;
        console.log(`[ToolUtils] Normalized ${field}: "${params[field]}" -> "${normalizedValue}"`);
      }
    }
  }

  // Auto-calculate end_datetime if start is present but end is not
  if (normalized.start_datetime && !normalized.end_datetime) {
    const duration = normalized.duration_minutes || 30;
    normalized.end_datetime = calculateEndDateTime(normalized.start_datetime, duration);
    console.log(`[ToolUtils] Auto-calculated end_datetime: ${normalized.end_datetime}`);
  }

  // Normalize attendees to array if string
  if (normalized.attendees && typeof normalized.attendees === 'string') {
    normalized.attendees = normalized.attendees.split(/[,;]\s*/).map(s => s.trim()).filter(Boolean);
  }

  return normalized;
}

/**
 * Check if a datetime string is in valid ISO format
 * @param {string} str - String to check
 * @returns {boolean} True if valid ISO datetime
 */
function isValidISODateTime(str) {
  if (!str || typeof str !== 'string') return false;

  // Must have T separator and proper structure
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/.test(str)) {
    return false;
  }

  const date = new Date(str);
  return !isNaN(date.getTime());
}

module.exports = {
  isToolSuccess,
  getToolError,
  normalizeDateTime,
  normalizeDateTimeAdvanced,
  normalizeWithResolver,
  calculateEndDateTime,
  normalizeParams,
  isValidISODateTime,
  getTemporalResolver,
};
