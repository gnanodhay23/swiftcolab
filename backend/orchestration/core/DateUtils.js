/**
 * DateUtils - Date/Time utility functions
 *
 * Extracted from old ToolRouter.js for reuse across the codebase.
 */

/**
 * Get ISO date string for a given date
 */
function getDateString(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Get today's date range (start and end of day)
 */
function getTodayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: getDateString(start),
    endDate: getDateString(end)
  };
}

/**
 * Get this week's date range
 */
function getWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - dayOfWeek);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: getDateString(start),
    endDate: getDateString(end)
  };
}

/**
 * Get tomorrow's date range
 */
function getTomorrowRange() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const start = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
  const end = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: getDateString(start),
    endDate: getDateString(end)
  };
}

/**
 * Parse natural language date/time to ISO format
 *
 * Examples:
 * - "tomorrow at 3pm" → 2025-12-18T15:00:00
 * - "next Monday" → 2025-12-22T00:00:00
 * - "in 2 hours" → now + 2 hours
 */
function parseNaturalDateTime(text, baseDate = new Date()) {
  if (!text) return null;

  const lowerText = text.toLowerCase().trim();
  const now = new Date(baseDate);

  // Handle "today"
  if (lowerText === 'today') {
    return getDateString(now);
  }

  // Handle "tomorrow"
  if (lowerText === 'tomorrow' || lowerText.startsWith('tomorrow')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Check for time
    const timeMatch = lowerText.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3]?.toLowerCase();

      if (period === 'pm' && hours < 12) hours += 12;
      if (period === 'am' && hours === 12) hours = 0;

      tomorrow.setHours(hours, minutes, 0, 0);
      return tomorrow.toISOString();
    }

    return getDateString(tomorrow);
  }

  // Handle "yesterday"
  if (lowerText === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return getDateString(yesterday);
  }

  // Handle "X days from now" or "in X days"
  const daysMatch = lowerText.match(/(?:in\s+)?(\d+)\s+days?\s*(?:from\s+now)?/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    const future = new Date(now);
    future.setDate(future.getDate() + days);

    // Check for time
    const timeMatch = lowerText.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3]?.toLowerCase();

      if (period === 'pm' && hours < 12) hours += 12;
      if (period === 'am' && hours === 12) hours = 0;

      future.setHours(hours, minutes, 0, 0);
      return future.toISOString();
    }

    return getDateString(future);
  }

  // Handle "X hours from now" or "in X hours"
  const hoursMatch = lowerText.match(/(?:in\s+)?(\d+)\s+hours?\s*(?:from\s+now)?/i);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1]);
    const future = new Date(now.getTime() + hours * 60 * 60 * 1000);
    return future.toISOString();
  }

  // Handle "X minutes from now"
  const minutesMatch = lowerText.match(/(?:in\s+)?(\d+)\s+minutes?\s*(?:from\s+now)?/i);
  if (minutesMatch) {
    const minutes = parseInt(minutesMatch[1]);
    const future = new Date(now.getTime() + minutes * 60 * 1000);
    return future.toISOString();
  }

  // Handle specific time (e.g., "3pm", "15:00")
  const timeOnlyMatch = lowerText.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (timeOnlyMatch) {
    let hours = parseInt(timeOnlyMatch[1]);
    const minutes = timeOnlyMatch[2] ? parseInt(timeOnlyMatch[2]) : 0;
    const period = timeOnlyMatch[3]?.toLowerCase();

    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;

    const result = new Date(now);
    result.setHours(hours, minutes, 0, 0);

    // If the time has passed today, assume tomorrow
    if (result < now) {
      result.setDate(result.getDate() + 1);
    }

    return result.toISOString();
  }

  // Handle next weekday (e.g., "next Monday")
  const weekdayMatch = lowerText.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (weekdayMatch) {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = weekdays.indexOf(weekdayMatch[1].toLowerCase());
    const currentDay = now.getDay();

    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;

    const nextWeekday = new Date(now);
    nextWeekday.setDate(now.getDate() + daysToAdd);
    return getDateString(nextWeekday);
  }

  // If already in ISO format (with or without timezone), return as-is
  // This prevents unnecessary UTC conversion
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  if (isoRegex.test(text)) {
    return text; // Already formatted, don't convert to UTC
  }

  // Try to parse as other date format
  const parsedDate = new Date(text);
  if (!isNaN(parsedDate.getTime())) {
    // Return in local ISO format (without Z suffix to avoid UTC conversion by downstream)
    const localISO = parsedDate.getFullYear() + '-' +
      String(parsedDate.getMonth() + 1).padStart(2, '0') + '-' +
      String(parsedDate.getDate()).padStart(2, '0') + 'T' +
      String(parsedDate.getHours()).padStart(2, '0') + ':' +
      String(parsedDate.getMinutes()).padStart(2, '0') + ':' +
      String(parsedDate.getSeconds()).padStart(2, '0');
    return localISO;
  }

  return null;
}

/**
 * Add duration to a time
 *
 * @param {string} startTime - ISO datetime string
 * @param {number} minutes - Duration in minutes
 * @returns {string} End time in local ISO format (no UTC conversion)
 */
function addDurationToTime(startTime, minutes) {
  const start = new Date(startTime);
  const end = new Date(start.getTime() + minutes * 60 * 1000);

  // Return in local ISO format (without Z suffix to avoid UTC issues)
  const localISO = end.getFullYear() + '-' +
    String(end.getMonth() + 1).padStart(2, '0') + '-' +
    String(end.getDate()).padStart(2, '0') + 'T' +
    String(end.getHours()).padStart(2, '0') + ':' +
    String(end.getMinutes()).padStart(2, '0') + ':' +
    String(end.getSeconds()).padStart(2, '0');
  return localISO;
}

// Empty patterns (these were in old ToolRouter but now routing is LLM-based)
const INTENT_PATTERNS = {};
const INTENT_ACTION_MAP = {};

module.exports = {
  getDateString,
  getTodayRange,
  getWeekRange,
  getTomorrowRange,
  parseNaturalDateTime,
  addDurationToTime,
  INTENT_PATTERNS,
  INTENT_ACTION_MAP
};
