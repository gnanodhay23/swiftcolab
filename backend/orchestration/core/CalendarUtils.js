/**
 * Calendar Utilities Module
 *
 * Handles timezone resolution, calendar response normalization,
 * and user-friendly formatting.
 */

// ============================================
// TIMEZONE RESOLUTION
// ============================================

/**
 * Build calendar time range based on user's timezone
 */
function buildCalendarTimeRange(intent, userContext) {
  const timezone = resolveTimezone(userContext);
  const now = new Date();

  // Get "today" in user's timezone
  const userLocalDate = new Date(
    now.toLocaleString("en-US", { timeZone: timezone })
  );

  let startOfDay, endOfDay;

  switch (intent) {
    case 'tomorrow':
      startOfDay = new Date(userLocalDate);
      startOfDay.setDate(startOfDay.getDate() + 1);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(startOfDay);
      endOfDay.setHours(23, 59, 59, 999);
      break;

    case 'this_week':
      startOfDay = getStartOfWeek(userLocalDate);
      endOfDay = getEndOfWeek(userLocalDate);
      break;

    case 'next_week':
      const nextWeekStart = new Date(userLocalDate);
      nextWeekStart.setDate(nextWeekStart.getDate() + (7 - nextWeekStart.getDay()));
      startOfDay = getStartOfWeek(nextWeekStart);
      endOfDay = getEndOfWeek(nextWeekStart);
      break;

    case 'today':
    default:
      // Default to today
      startOfDay = new Date(userLocalDate);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(userLocalDate);
      endOfDay.setHours(23, 59, 59, 999);
      break;
  }

  // Convert to UTC for API call
  const timeMin = convertLocalToUTC(startOfDay, timezone);
  const timeMax = convertLocalToUTC(endOfDay, timezone);

  return {
    timeMin: timeMin.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    timeMax: timeMax.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    resolvedTimezone: timezone,
    localDate: userLocalDate.toISOString().split('T')[0],
    intent
  };
}

/**
 * Resolve timezone with priority order
 */
function resolveTimezone(userContext) {
  // Priority 1: Explicit timezone in context
  if (userContext?.timezone) {
    return userContext.timezone;
  }

  // Priority 2: User profile timezone
  if (userContext?.userProfile?.timezone) {
    return userContext.userProfile.timezone;
  }

  // Priority 3: Calendar's timezone
  if (userContext?.calendarTimezone) {
    return userContext.calendarTimezone;
  }

  // Priority 4: Try to detect from system
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (e) {
    // Last resort default
    return "America/New_York";
  }
}

/**
 * Convert local time to UTC accounting for timezone
 */
function convertLocalToUTC(localDate, timezone) {
  // Get the offset for the specific timezone at the given date
  const offsetMinutes = getTimezoneOffset(localDate, timezone);

  // Create UTC date by adding the offset
  const utcDate = new Date(localDate.getTime() + offsetMinutes * 60 * 1000);
  return utcDate;
}

/**
 * Get timezone offset in minutes for a specific date
 */
function getTimezoneOffset(date, timezone) {
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return (utcDate - tzDate) / 60000;
}

function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEndOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() + (6 - day);
  d.setDate(diff);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ============================================
// RESPONSE NORMALIZATION
// ============================================

/**
 * Normalize calendar events from raw API response
 */
function normalizeCalendarEvents(rawResponse, userTimezone) {
  const data = rawResponse?.data || rawResponse;

  // Handle different response structures
  const events = data?.items || data?.event_data?.event_data || data?.event_data || [];

  return {
    success: true,
    events: events.map(event => normalizeEvent(event, userTimezone)),
    metadata: {
      calendarId: data?.summary || 'primary',
      calendarTimezone: data?.timeZone || userTimezone,
      totalEvents: events.length,
      queryDate: new Date().toISOString()
    }
  };
}

/**
 * Normalize a single event
 */
function normalizeEvent(event, userTimezone) {
  const startTime = parseEventTime(event.start);
  const endTime = parseEventTime(event.end);

  return {
    id: event.id,
    title: event.summary || "(No title)",
    description: event.description || null,

    // Normalized time representation
    start: startTime ? {
      utc: startTime.utc,
      local: formatInTimezone(startTime.utc, userTimezone),
      timezone: userTimezone,
      isAllDay: startTime.isAllDay
    } : null,

    end: endTime ? {
      utc: endTime.utc,
      local: formatInTimezone(endTime.utc, userTimezone),
      timezone: userTimezone,
      isAllDay: endTime.isAllDay
    } : null,

    duration: startTime && endTime ? calculateDuration(startTime.utc, endTime.utc) : null,

    attendees: (event.attendees || []).map(a => ({
      email: a.email,
      name: a.displayName || a.email?.split('@')[0],
      status: a.responseStatus,
      isOrganizer: a.organizer || false,
      isSelf: a.self || false
    })),

    organizer: event.organizer ? {
      email: event.organizer.email,
      name: event.organizer.displayName || event.organizer.email?.split('@')[0],
      isSelf: event.organizer.self || false
    } : null,

    links: {
      htmlLink: event.htmlLink,
      meetLink: event.hangoutLink || null
    },

    status: event.status,
    created: event.created,
    updated: event.updated
  };
}

/**
 * Parse event time from various formats
 */
function parseEventTime(timeObj) {
  if (!timeObj) return null;

  // Handle all-day events (date only, no dateTime)
  if (timeObj.date && !timeObj.dateTime) {
    return {
      utc: new Date(timeObj.date + "T00:00:00Z").toISOString(),
      isAllDay: true
    };
  }

  // Handle datetime events
  if (timeObj.dateTime) {
    // The dateTime field includes offset, so we can parse directly
    const utc = new Date(timeObj.dateTime).toISOString();

    return {
      utc,
      isAllDay: false,
      originalTimezone: timeObj.timeZone
    };
  }

  return null;
}

/**
 * Format time in a specific timezone
 */
function formatInTimezone(utcString, timezone) {
  try {
    const date = new Date(utcString);

    return {
      dateTime: date.toLocaleString('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }),
      time: date.toLocaleString('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }),
      date: date.toLocaleDateString('en-US', {
        timeZone: timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }),
      hour24: parseInt(date.toLocaleString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false
      }))
    };
  } catch (e) {
    console.error('Error formatting timezone:', e);
    return {
      dateTime: utcString,
      time: utcString,
      date: utcString,
      hour24: 0
    };
  }
}

/**
 * Calculate duration between two times
 */
function calculateDuration(startUtc, endUtc) {
  const start = new Date(startUtc);
  const end = new Date(endUtc);
  const minutes = Math.round((end - start) / 60000);

  if (minutes < 60) {
    return `${minutes} min`;
  } else if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hr${hours > 1 ? 's' : ''}`;
  } else {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours} hr ${mins} min`;
  }
}

// ============================================
// USER-FRIENDLY FORMATTING
// ============================================

/**
 * Format calendar response for user display
 */
function formatCalendarResponse(normalizedData, userTimezone) {
  const { events, metadata } = normalizedData;

  if (!events || events.length === 0) {
    return {
      message: "You have no events scheduled for today.",
      events: [],
      grouped: { morning: [], afternoon: [], evening: [] },
      summary: {
        total: 0,
        date: formatDateHeader(new Date(), userTimezone)
      }
    };
  }

  // Sort events by start time
  const sortedEvents = [...events].sort((a, b) => {
    if (!a.start?.utc || !b.start?.utc) return 0;
    return new Date(a.start.utc) - new Date(b.start.utc);
  });

  // Group by time of day
  const grouped = groupByTimeOfDay(sortedEvents, userTimezone);

  // Build human-readable message
  const message = buildCalendarSummary(sortedEvents, userTimezone);

  return {
    message,
    events: sortedEvents.map(e => formatEventForDisplay(e)),
    grouped,
    summary: {
      total: events.length,
      date: formatDateHeader(new Date(), userTimezone),
      breakdown: {
        morning: grouped.morning.length,
        afternoon: grouped.afternoon.length,
        evening: grouped.evening.length
      }
    }
  };
}

/**
 * Group events by time of day
 */
function groupByTimeOfDay(events, timezone) {
  const groups = {
    morning: [],    // 6am - 12pm
    afternoon: [],  // 12pm - 5pm
    evening: []     // 5pm onwards
  };

  for (const event of events) {
    if (!event.start?.local?.hour24) continue;

    const hour = event.start.local.hour24;

    if (hour >= 6 && hour < 12) {
      groups.morning.push(event);
    } else if (hour >= 12 && hour < 17) {
      groups.afternoon.push(event);
    } else {
      groups.evening.push(event);
    }
  }

  return groups;
}

/**
 * Build human-readable calendar summary
 */
function buildCalendarSummary(events, timezone) {
  const count = events.length;
  const eventWord = count === 1 ? "event" : "events";

  let summary = `You have ${count} ${eventWord} today:\n\n`;

  for (const event of events) {
    const time = event.start?.local?.time || 'TBD';
    const title = event.title || '(No title)';
    const duration = event.duration || '';

    summary += `- ${time} - ${title}`;
    if (duration) summary += ` (${duration})`;

    // Add attendee info if there are external attendees
    const externalAttendees = (event.attendees || []).filter(a => !a.isSelf);
    if (externalAttendees.length > 0) {
      const names = externalAttendees.slice(0, 2).map(a => a.name || a.email?.split('@')[0]);
      if (externalAttendees.length > 2) {
        summary += ` with ${names.join(', ')} +${externalAttendees.length - 2} more`;
      } else if (names.length > 0) {
        summary += ` with ${names.join(', ')}`;
      }
    }

    summary += '\n';
  }

  return summary.trim();
}

/**
 * Format single event for display
 */
function formatEventForDisplay(event) {
  return {
    id: event.id,
    title: event.title,
    time: event.start?.local?.time || 'TBD',
    endTime: event.end?.local?.time || 'TBD',
    date: event.start?.local?.date || '',
    duration: event.duration,
    attendeeCount: event.attendees?.length || 0,
    hasExternalAttendees: (event.attendees || []).some(a => !a.isSelf),
    link: event.links?.htmlLink,
    meetLink: event.links?.meetLink
  };
}

/**
 * Format date header
 */
function formatDateHeader(date, timezone) {
  try {
    return date.toLocaleDateString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (e) {
    return date.toLocaleDateString();
  }
}

// ============================================
// VALIDATION
// ============================================

/**
 * Validate calendar query parameters
 */
function validateCalendarQuery(params, context) {
  const errors = [];
  const warnings = [];

  // Validate timezone consistency
  if (context?.userTimezone && context?.calendarTimezone) {
    if (context.userTimezone !== context.calendarTimezone) {
      warnings.push({
        code: "TIMEZONE_MISMATCH",
        message: `Your timezone (${context.userTimezone}) differs from calendar timezone (${context.calendarTimezone})`,
        suggestion: "Events will be shown in your local time"
      });
    }
  }

  // Validate time range
  const timeMin = new Date(params.timeMin);
  const timeMax = new Date(params.timeMax);
  const now = new Date();

  // Check for dates too far in the past
  const daysDiff = (now - timeMin) / (1000 * 60 * 60 * 24);
  if (daysDiff > 365) {
    errors.push({
      code: "DATE_TOO_OLD",
      message: `Query date ${timeMin.toISOString()} is more than a year in the past`,
      suggestion: "Did you mean to query today's events?"
    });
  }

  // Check for inverted range
  if (timeMax < timeMin) {
    errors.push({
      code: "INVALID_RANGE",
      message: "End time is before start time",
      suggestion: "Check date parameters"
    });
  }

  // Check for unreasonably large range
  const rangeDays = (timeMax - timeMin) / (1000 * 60 * 60 * 24);
  if (rangeDays > 90) {
    warnings.push({
      code: "LARGE_RANGE",
      message: `Query spans ${Math.round(rangeDays)} days`,
      suggestion: "Consider narrowing the date range for better performance"
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate calendar response data
 */
function validateCalendarResponse(response) {
  const warnings = [];
  const data = response?.data || response;
  const events = data?.items || data?.event_data?.event_data || [];

  for (const event of events) {
    // Check for missing title
    if (!event.summary) {
      warnings.push({
        eventId: event.id,
        code: "MISSING_TITLE",
        message: "Event has no title"
      });
    }

    // Check for contradictory timezone
    if (event.start?.timeZone === "UTC" &&
        event.start?.dateTime?.match(/-0[0-9]:00$/)) {
      warnings.push({
        eventId: event.id,
        code: "TIMEZONE_CONTRADICTION",
        message: "Event timezone metadata contradicts offset in dateTime"
      });
    }

    // Check for unusual times (likely test data)
    if (event.start?.dateTime) {
      const startTime = new Date(event.start.dateTime);
      const minutes = startTime.getMinutes();
      const seconds = startTime.getSeconds();

      if (seconds !== 0 && ![0, 15, 30, 45].includes(minutes)) {
        warnings.push({
          eventId: event.id,
          code: "UNUSUAL_TIME",
          message: `Event starts at unusual time`,
          suggestion: "This might be test data or a creation bug"
        });
      }
    }
  }

  return { warnings };
}

/**
 * Validate and fix date that might be in the past
 */
function validateAndFixDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return dateStr;
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;

  try {
    const datePart = dateStr.split('T')[0];
    const timePart = dateStr.includes('T') ? dateStr.substring(dateStr.indexOf('T')) : 'T00:00:00Z';
    const [year, month, day] = datePart.split('-').map(Number);

    const inputDate = new Date(year, month - 1, day);
    const now = new Date();
    const daysDiff = Math.floor((now - inputDate) / (1000 * 60 * 60 * 24));

    // If date is more than 180 days in the past, it's likely wrong
    if (daysDiff > 180) {
      let correctedYear = now.getFullYear();
      const thisYearDate = new Date(correctedYear, month - 1, day);
      if (thisYearDate < now) {
        correctedYear = correctedYear + 1;
      }
      const correctedDateStr = `${correctedYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}${timePart}`;
      console.log(`[CalendarUtils] FIXED PAST DATE: ${dateStr} -> ${correctedDateStr}`);
      return correctedDateStr;
    }
    return dateStr;
  } catch (e) {
    return dateStr;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Timezone
  buildCalendarTimeRange,
  resolveTimezone,
  convertLocalToUTC,
  getTimezoneOffset,

  // Normalization
  normalizeCalendarEvents,
  normalizeEvent,
  parseEventTime,
  formatInTimezone,
  calculateDuration,

  // Formatting
  formatCalendarResponse,
  groupByTimeOfDay,
  buildCalendarSummary,
  formatEventForDisplay,
  formatDateHeader,

  // Validation
  validateCalendarQuery,
  validateCalendarResponse,
  validateAndFixDate
};
