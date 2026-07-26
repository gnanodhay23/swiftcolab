/**
 * TemporalResolver - Timezone-Aware Temporal Resolution
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │                 TEMPORAL RESOLVER                           │
 * │                                                             │
 * │  1. Expression Parser → structured components               │
 * │  2. Timezone Resolver → determine user's timezone           │
 * │  3. Ambiguity Detector → identify unclear parts + risk      │
 * │  4. Resolution Strategy → apply defaults or ask user        │
 * │  5. DST-Safe Normalization → local + tz identifier + UTC    │
 * │  6. Confirmation Generator → human-readable confirmation    │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Key principle: Store timezone IDENTIFIER (America/New_York),
 * NEVER just offset (-05:00) which breaks across DST transitions.
 */

// ============================================
// CONFIGURATION: Fuzzy Time Defaults
// ============================================
const FUZZY_TIME_DEFAULTS = {
  morning: {
    default_hour: 9,
    range: [6, 12],
    work_context_hour: 9,
    personal_context_hour: 10,
  },
  afternoon: {
    default_hour: 14,
    range: [12, 17],
    work_context_hour: 14,
    personal_context_hour: 15,
  },
  evening: {
    default_hour: 18,
    range: [17, 21],
    work_context_hour: 18,
    personal_context_hour: 19,
  },
  night: {
    default_hour: 21,
    range: [21, 24],
    work_context_hour: null,
    personal_context_hour: 21,
  },
  'end of day': {
    default_hour: 17,
    range: [17, 18],
    work_context_hour: 17,
    personal_context_hour: 18,
  },
  eod: {
    default_hour: 17,
    range: [17, 18],
    work_context_hour: 17,
    personal_context_hour: 18,
  },
  lunch: {
    default_hour: 12,
    range: [11, 13],
    work_context_hour: 12,
    personal_context_hour: 12,
  },
  midday: {
    default_hour: 12,
    range: [11, 13],
  },
  noon: {
    default_hour: 12,
    range: [12, 12],
  },
  midnight: {
    default_hour: 0,
    range: [0, 0],
  },
};

// Relative duration mappings
const RELATIVE_DURATION_DEFAULTS = {
  later: { hours_from_now: 3, min_hours: 2 },
  soon: { hours_from_now: 1, min_hours: 0.5 },
  'in a bit': { hours_from_now: 2, min_hours: 1 },
  'in a few hours': { hours_from_now: 3, range: [2, 4] },
  'in a couple hours': { hours_from_now: 2, range: [1.5, 2.5] },
  shortly: { hours_from_now: 0.5, min_hours: 0.25 },
};

// Timezone aliases
const TIMEZONE_ALIASES = {
  // US timezones
  est: 'America/New_York',
  edt: 'America/New_York',
  eastern: 'America/New_York',
  'eastern time': 'America/New_York',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  central: 'America/Chicago',
  'central time': 'America/Chicago',
  mst: 'America/Denver',
  mdt: 'America/Denver',
  mountain: 'America/Denver',
  'mountain time': 'America/Denver',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  pacific: 'America/Los_Angeles',
  'pacific time': 'America/Los_Angeles',
  // International
  gmt: 'UTC',
  utc: 'UTC',
  bst: 'Europe/London',
  'uk time': 'Europe/London',
  london: 'Europe/London',
  'london time': 'Europe/London',
  cet: 'Europe/Paris',
  'paris time': 'Europe/Paris',
  ist: 'Asia/Kolkata',
  'india time': 'Asia/Kolkata',
  jst: 'Asia/Tokyo',
  'tokyo time': 'Asia/Tokyo',
  'japan time': 'Asia/Tokyo',
  aest: 'Australia/Sydney',
  'sydney time': 'Australia/Sydney',
  // Common cities
  'new york': 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  chicago: 'America/Chicago',
  denver: 'America/Denver',
  seattle: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  toronto: 'America/Toronto',
  vancouver: 'America/Vancouver',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  amsterdam: 'Europe/Amsterdam',
  dubai: 'Asia/Dubai',
  singapore: 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  tokyo: 'Asia/Tokyo',
  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
};

// Day names
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBREVS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Context keywords for AM/PM resolution
const MORNING_KEYWORDS = ['breakfast', 'morning', 'am', 'early', 'dawn', 'sunrise'];
const EVENING_KEYWORDS = ['dinner', 'evening', 'pm', 'night', 'late', 'sunset', 'dusk'];
const WORK_KEYWORDS = ['meeting', 'call', 'standup', 'sync', 'review', 'interview', 'presentation'];

// ============================================
// AMBIGUITY TYPES
// ============================================
const AMBIGUITY_TYPES = {
  AM_PM_UNCLEAR: 'am_pm_unclear',
  RELATIVE_WEEK_UNCLEAR: 'relative_week_unclear',
  FUZZY_TIME: 'fuzzy_time',
  VAGUE_DURATION: 'vague_duration',
  TIMEZONE_AMBIGUOUS: 'timezone_ambiguous',
  MULTI_TIMEZONE_MEETING: 'multi_timezone_meeting',
  DATE_UNCLEAR: 'date_unclear',
  YEAR_UNCLEAR: 'year_unclear',
};

// Risk multipliers
const RISK_MULTIPLIERS = {
  external_attendees: 2.0,
  multi_timezone: 2.5,
  irreversible_action: 1.5,
  far_future: 1.3, // >2 weeks away
  business_hours_unlikely: 1.5,
};

// Risk thresholds
const RISK_THRESHOLDS = {
  SILENT: 0.3,      // Proceed with defaults silently
  INLINE: 0.7,      // Proceed but confirm inline
  EXPLICIT: 0.7,    // Explicitly ask before proceeding
};

// ============================================
// MAIN CLASS: TemporalResolver
// ============================================
class TemporalResolver {
  constructor(options = {}) {
    this.defaultTimezone = options.defaultTimezone || 'America/Los_Angeles';
    this.locale = options.locale || 'en-US';
    this.weekStartsOn = options.weekStartsOn || 0; // 0 = Sunday
    this.userPreferences = options.userPreferences || {};
  }

  /**
   * Main entry point: Resolve a natural language time expression
   * @param {string} input - Natural language time expression
   * @param {Object} context - Additional context (user timezone, attendees, etc.)
   * @returns {Object} Resolution result with datetime, ambiguities, and confirmations
   */
  resolve(input, context = {}) {
    if (!input || typeof input !== 'string') {
      return { success: false, error: 'No input provided' };
    }

    const referenceDate = context.referenceDate || new Date();
    const userTimezone = this.resolveTimezone(input, context);

    // Step 1: Parse the expression
    const parsed = this.parseExpression(input, referenceDate);

    // Step 2: Detect ambiguities
    const ambiguities = this.detectAmbiguities(parsed, context);

    // Step 3: Calculate risk score
    const riskScore = this.calculateRiskScore(ambiguities, context);

    // Step 4: Determine resolution strategy
    const strategy = this.determineStrategy(riskScore, ambiguities);

    // Step 5: Apply resolution (if we can proceed)
    let resolved = null;
    let needsClarification = false;
    let clarificationQuestions = [];

    if (strategy.canProceed) {
      resolved = this.applyResolution(parsed, ambiguities, context, referenceDate, userTimezone);
    } else {
      needsClarification = true;
      clarificationQuestions = this.generateClarificationQuestions(ambiguities, parsed, context);
    }

    // Step 6: Generate confirmation message
    const confirmation = resolved
      ? this.generateConfirmation(resolved, context, strategy.confirmationLevel)
      : null;

    return {
      success: !needsClarification,
      input,
      parsed,
      ambiguities,
      riskScore,
      strategy,
      resolved,
      needsClarification,
      clarificationQuestions,
      confirmation,
      timezone: userTimezone,
    };
  }

  // ============================================
  // COMPONENT 1: Expression Parser
  // ============================================

  /**
   * Parse natural language time expression into structured components
   */
  parseExpression(input, referenceDate = new Date()) {
    const normalized = input.toLowerCase().trim();

    const result = {
      raw_input: input,
      parsed: {
        date: this.parseDateComponent(normalized, referenceDate),
        time: this.parseTimeComponent(normalized),
        timezone: this.parseTimezoneComponent(normalized),
        duration: this.parseDurationComponent(normalized),
        recurrence: this.parseRecurrenceComponent(normalized),
      },
      ambiguities: [],
      confidence: 1.0,
    };

    // Detect ambiguities during parsing
    result.ambiguities = this.identifyParsingAmbiguities(result.parsed, normalized);

    // Calculate confidence based on ambiguities
    result.confidence = Math.max(0, 1 - (result.ambiguities.length * 0.15));

    return result;
  }

  /**
   * Parse the date component
   */
  parseDateComponent(input, referenceDate) {
    const result = {
      type: null,
      reference: null,
      modifier: null,
      explicit_date: null,
      day_of_week: null,
    };

    // Check for explicit date formats first
    // Format: YYYY-MM-DD
    const isoMatch = input.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      result.type = 'explicit';
      result.explicit_date = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
      return result;
    }

    // Format: MM/DD/YYYY or MM/DD
    const usDateMatch = input.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
    if (usDateMatch) {
      const month = usDateMatch[1].padStart(2, '0');
      const day = usDateMatch[2].padStart(2, '0');
      const year = usDateMatch[3] || referenceDate.getFullYear();
      result.type = 'explicit';
      result.explicit_date = `${year}-${month}-${day}`;
      return result;
    }

    // Format: Month Day (Dec 20, December 20th)
    const monthDayMatch = input.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i);
    if (monthDayMatch) {
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthIndex = monthNames.findIndex(m => monthDayMatch[1].toLowerCase().startsWith(m));
      const month = String(monthIndex + 1).padStart(2, '0');
      const day = monthDayMatch[2].padStart(2, '0');
      const year = monthDayMatch[3] || this.inferYear(monthIndex, parseInt(monthDayMatch[2]), referenceDate);
      result.type = 'explicit';
      result.explicit_date = `${year}-${month}-${day}`;
      return result;
    }

    // Relative date patterns
    if (/\btoday\b/.test(input)) {
      result.type = 'relative';
      result.reference = 'today';
      result.modifier = null;
      return result;
    }

    if (/\b(tmr|tomorrow)\b/.test(input)) {
      result.type = 'relative';
      result.reference = 'tomorrow';
      result.modifier = null;
      return result;
    }

    if (/\byesterday\b/.test(input)) {
      result.type = 'relative';
      result.reference = 'yesterday';
      result.modifier = null;
      return result;
    }

    if (/\bday after (tomorrow|tmr)\b/.test(input)) {
      result.type = 'relative';
      result.reference = 'day_after_tomorrow';
      result.modifier = null;
      return result;
    }

    // "in X days"
    const inDaysMatch = input.match(/in\s+(\d+)\s+days?/);
    if (inDaysMatch) {
      result.type = 'relative';
      result.reference = 'in_days';
      result.modifier = parseInt(inDaysMatch[1]);
      return result;
    }

    // "next week" / "this week"
    if (/\bnext week\b/.test(input)) {
      result.type = 'relative';
      result.reference = 'next_week';
      return result;
    }

    if (/\bthis week\b/.test(input)) {
      result.type = 'relative';
      result.reference = 'this_week';
      return result;
    }

    // Day of week patterns
    for (let i = 0; i < DAY_NAMES.length; i++) {
      const dayName = DAY_NAMES[i];
      const dayAbbrev = DAY_ABBREVS[i];

      // "next Friday", "this Friday", "on Friday", just "Friday"
      const nextPattern = new RegExp(`\\bnext\\s+${dayName}|\\bnext\\s+${dayAbbrev}\\b`, 'i');
      const thisPattern = new RegExp(`\\bthis\\s+${dayName}|\\bthis\\s+${dayAbbrev}\\b`, 'i');
      const onPattern = new RegExp(`\\bon\\s+${dayName}|\\bon\\s+${dayAbbrev}\\b`, 'i');
      const barePattern = new RegExp(`\\b${dayName}\\b|\\b${dayAbbrev}\\b`, 'i');

      if (nextPattern.test(input)) {
        result.type = 'relative';
        result.reference = dayName;
        result.modifier = 'next';
        result.day_of_week = i;
        return result;
      }

      if (thisPattern.test(input)) {
        result.type = 'relative';
        result.reference = dayName;
        result.modifier = 'this';
        result.day_of_week = i;
        return result;
      }

      if (onPattern.test(input) || barePattern.test(input)) {
        result.type = 'relative';
        result.reference = dayName;
        result.modifier = null; // Nearest occurrence
        result.day_of_week = i;
        return result;
      }
    }

    // No date component found - will use today or infer from context
    result.type = 'inferred';
    return result;
  }

  /**
   * Parse the time component
   */
  parseTimeComponent(input) {
    const result = {
      type: null,
      hour: null,
      minute: null,
      period: null, // 'am', 'pm', or null
      explicit_time: null,
      fuzzy_name: null,
    };

    // Check for fuzzy time expressions first
    for (const [fuzzyName, config] of Object.entries(FUZZY_TIME_DEFAULTS)) {
      const pattern = new RegExp(`\\b${fuzzyName.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(input)) {
        result.type = 'fuzzy';
        result.fuzzy_name = fuzzyName;
        result.hour = config.default_hour;
        result.minute = 0;
        return result;
      }
    }

    // Check for relative duration
    for (const [phrase, config] of Object.entries(RELATIVE_DURATION_DEFAULTS)) {
      const pattern = new RegExp(`\\b${phrase.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(input)) {
        result.type = 'relative';
        result.fuzzy_name = phrase;
        result.hours_from_now = config.hours_from_now;
        return result;
      }
    }

    // "in X hours"
    const inHoursMatch = input.match(/in\s+(\d+(?:\.\d+)?)\s+hours?/i);
    if (inHoursMatch) {
      result.type = 'relative';
      result.hours_from_now = parseFloat(inHoursMatch[1]);
      return result;
    }

    // "in X minutes"
    const inMinutesMatch = input.match(/in\s+(\d+)\s+(?:minutes?|mins?)/i);
    if (inMinutesMatch) {
      result.type = 'relative';
      result.minutes_from_now = parseInt(inMinutesMatch[1]);
      return result;
    }

    // 12-hour format: "3pm", "3:30 pm", "3:30pm"
    const time12Match = input.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (time12Match) {
      result.type = 'explicit';
      result.hour = parseInt(time12Match[1]);
      result.minute = time12Match[2] ? parseInt(time12Match[2]) : 0;
      result.period = time12Match[3].toLowerCase();
      result.explicit_time = this.to24Hour(result.hour, result.minute, result.period);
      return result;
    }

    // 24-hour format: "15:00", "15:30"
    const time24Match = input.match(/\b(\d{2}):(\d{2})\b/);
    if (time24Match) {
      const hour = parseInt(time24Match[1]);
      const minute = parseInt(time24Match[2]);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        result.type = 'explicit';
        result.hour = hour;
        result.minute = minute;
        result.period = hour < 12 ? 'am' : 'pm';
        result.explicit_time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        return result;
      }
    }

    // Partial time: "at 3", "at 3:30" (no am/pm)
    const partialTimeMatch = input.match(/at\s+(\d{1,2})(?::(\d{2}))?(?!\s*(?:am|pm))/i);
    if (partialTimeMatch) {
      result.type = 'partial';
      result.hour = parseInt(partialTimeMatch[1]);
      result.minute = partialTimeMatch[2] ? parseInt(partialTimeMatch[2]) : 0;
      result.period = null; // Ambiguous!
      return result;
    }

    // Just a number that might be a time: "3ish", "around 5"
    const roughTimeMatch = input.match(/(?:around|about|~|approximately)\s*(\d{1,2})(?:ish)?|(\d{1,2})ish/i);
    if (roughTimeMatch) {
      result.type = 'approximate';
      result.hour = parseInt(roughTimeMatch[1] || roughTimeMatch[2]);
      result.minute = 0;
      result.period = null;
      return result;
    }

    // No time found
    result.type = 'not_specified';
    return result;
  }

  /**
   * Parse timezone component from input
   */
  parseTimezoneComponent(input) {
    const result = {
      explicit: null,
      mentioned: null,
      mentioned_location: null,
    };

    const normalized = input.toLowerCase();

    // Check for explicit timezone mentions
    for (const [alias, tz] of Object.entries(TIMEZONE_ALIASES)) {
      const pattern = new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(normalized)) {
        result.explicit = tz;
        result.mentioned = alias;
        return result;
      }
    }

    // Check for "X time" patterns
    const timePattern = /(\w+(?:\s+\w+)?)\s+time\b/i;
    const timeMatch = normalized.match(timePattern);
    if (timeMatch) {
      const location = timeMatch[1].toLowerCase();
      if (TIMEZONE_ALIASES[location]) {
        result.explicit = TIMEZONE_ALIASES[location];
        result.mentioned = location;
        return result;
      }
      // Store unresolved location mention
      result.mentioned_location = location;
    }

    return result;
  }

  /**
   * Parse duration component (for meeting length)
   */
  parseDurationComponent(input) {
    const result = {
      specified: false,
      minutes: null,
    };

    // "for X hours"
    const hoursMatch = input.match(/for\s+(\d+(?:\.\d+)?)\s+hours?/i);
    if (hoursMatch) {
      result.specified = true;
      result.minutes = Math.round(parseFloat(hoursMatch[1]) * 60);
      return result;
    }

    // "for X minutes"
    const minutesMatch = input.match(/for\s+(\d+)\s+(?:minutes?|mins?)/i);
    if (minutesMatch) {
      result.specified = true;
      result.minutes = parseInt(minutesMatch[1]);
      return result;
    }

    // "30 min meeting", "1 hour meeting"
    const durationPrefixMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr|minute|min)s?\s+(?:meeting|call|event)/i);
    if (durationPrefixMatch) {
      const value = parseFloat(durationPrefixMatch[1]);
      const isHours = /hour|hr/i.test(durationPrefixMatch[0]);
      result.specified = true;
      result.minutes = isHours ? Math.round(value * 60) : Math.round(value);
      return result;
    }

    return result;
  }

  /**
   * Parse recurrence component
   */
  parseRecurrenceComponent(input) {
    const result = {
      specified: false,
      frequency: null,
      interval: null,
      days_of_week: null,
    };

    if (/\b(daily|every day)\b/i.test(input)) {
      result.specified = true;
      result.frequency = 'daily';
      result.interval = 1;
      return result;
    }

    if (/\b(weekly|every week)\b/i.test(input)) {
      result.specified = true;
      result.frequency = 'weekly';
      result.interval = 1;
      return result;
    }

    if (/\b(monthly|every month)\b/i.test(input)) {
      result.specified = true;
      result.frequency = 'monthly';
      result.interval = 1;
      return result;
    }

    // "every Monday", "every Mon and Wed"
    const everyDayMatch = input.match(/every\s+((?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?(?:\s*(?:,|and)\s*)?)+)/i);
    if (everyDayMatch) {
      result.specified = true;
      result.frequency = 'weekly';
      result.interval = 1;
      result.days_of_week = this.parseDayList(everyDayMatch[1]);
      return result;
    }

    return result;
  }

  /**
   * Helper: Parse a list of day names
   */
  parseDayList(input) {
    const days = [];
    for (let i = 0; i < DAY_NAMES.length; i++) {
      const dayName = DAY_NAMES[i];
      const dayAbbrev = DAY_ABBREVS[i];
      if (new RegExp(`\\b${dayName}|\\b${dayAbbrev}`, 'i').test(input)) {
        days.push(i);
      }
    }
    return days.length > 0 ? days : null;
  }

  /**
   * Helper: Convert 12-hour to 24-hour format
   */
  to24Hour(hour, minute, period) {
    let h = hour;
    if (period === 'pm' && hour < 12) h += 12;
    if (period === 'am' && hour === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  /**
   * Helper: Infer year for a month/day
   */
  inferYear(month, day, referenceDate) {
    const currentYear = referenceDate.getFullYear();
    const currentMonth = referenceDate.getMonth();
    const currentDay = referenceDate.getDate();

    // If the date has passed this year, assume next year
    if (month < currentMonth || (month === currentMonth && day < currentDay)) {
      return currentYear + 1;
    }
    return currentYear;
  }

  /**
   * Identify ambiguities during parsing
   */
  identifyParsingAmbiguities(parsed, input) {
    const ambiguities = [];

    // AM/PM unclear
    if (parsed.time.type === 'partial' || parsed.time.type === 'approximate') {
      ambiguities.push({
        field: 'time.period',
        type: AMBIGUITY_TYPES.AM_PM_UNCLEAR,
        value: parsed.time.hour,
        candidates: [
          `${String(parsed.time.hour).padStart(2, '0')}:${String(parsed.time.minute || 0).padStart(2, '0')}`,
          `${String(parsed.time.hour + 12).padStart(2, '0')}:${String(parsed.time.minute || 0).padStart(2, '0')}`,
        ],
      });
    }

    // Relative week unclear ("next Friday")
    if (parsed.date.type === 'relative' && parsed.date.modifier === 'next' && parsed.date.day_of_week !== null) {
      ambiguities.push({
        field: 'date.reference',
        type: AMBIGUITY_TYPES.RELATIVE_WEEK_UNCLEAR,
        value: `next ${parsed.date.reference}`,
        candidates: [], // Will be filled during resolution
      });
    }

    // Fuzzy time
    if (parsed.time.type === 'fuzzy') {
      ambiguities.push({
        field: 'time.hour',
        type: AMBIGUITY_TYPES.FUZZY_TIME,
        value: parsed.time.fuzzy_name,
        default_hour: parsed.time.hour,
      });
    }

    // Vague duration
    if (parsed.time.type === 'relative' && parsed.time.fuzzy_name) {
      ambiguities.push({
        field: 'time.duration',
        type: AMBIGUITY_TYPES.VAGUE_DURATION,
        value: parsed.time.fuzzy_name,
      });
    }

    // No explicit timezone
    if (!parsed.timezone.explicit && !parsed.timezone.mentioned_location) {
      ambiguities.push({
        field: 'timezone',
        type: AMBIGUITY_TYPES.TIMEZONE_AMBIGUOUS,
        value: 'not specified',
      });
    }

    return ambiguities;
  }

  // ============================================
  // COMPONENT 2: Timezone Resolution
  // ============================================

  /**
   * Resolve timezone from multiple sources (hierarchy)
   */
  resolveTimezone(input, context = {}) {
    // 1. Explicit in message
    const parsedTz = this.parseTimezoneComponent(input);
    if (parsedTz.explicit) {
      return {
        timezone: parsedTz.explicit,
        source: 'explicit_in_message',
        confidence: 1.0,
        mentioned: parsedTz.mentioned,
      };
    }

    // 2. User profile timezone
    if (context.userTimezone) {
      return {
        timezone: context.userTimezone,
        source: 'user_profile',
        confidence: 0.95,
      };
    }

    // 3. Device timezone (from frontend)
    if (context.deviceTimezone) {
      return {
        timezone: context.deviceTimezone,
        source: 'device',
        confidence: 0.9,
      };
    }

    // 4. Organization default
    if (context.organizationTimezone) {
      return {
        timezone: context.organizationTimezone,
        source: 'organization_default',
        confidence: 0.8,
      };
    }

    // 5. Default fallback
    return {
      timezone: this.defaultTimezone,
      source: 'system_default',
      confidence: 0.5,
    };
  }

  // ============================================
  // COMPONENT 3: Ambiguity Detection
  // ============================================

  /**
   * Detect all ambiguities and classify them
   */
  detectAmbiguities(parsed, context) {
    // Start with parsing ambiguities
    const ambiguities = [...parsed.ambiguities];

    // Multi-timezone meeting detection
    if (context.attendees && Array.isArray(context.attendees)) {
      const timezones = new Set();
      if (context.userTimezone) timezones.add(context.userTimezone);

      for (const attendee of context.attendees) {
        if (attendee.timezone) {
          timezones.add(attendee.timezone);
        }
        // Check for location mentions that imply different timezone
        if (attendee.location) {
          const tz = TIMEZONE_ALIASES[attendee.location.toLowerCase()];
          if (tz) timezones.add(tz);
        }
      }

      if (timezones.size > 1) {
        ambiguities.push({
          field: 'meeting_timezones',
          type: AMBIGUITY_TYPES.MULTI_TIMEZONE_MEETING,
          timezones: Array.from(timezones),
          value: `${timezones.size} timezones involved`,
        });
      }
    }

    // Check for mentioned locations that might imply timezone
    if (parsed.parsed.timezone.mentioned_location) {
      const mentioned = parsed.parsed.timezone.mentioned_location;
      const resolvedTz = context.userTimezone || this.defaultTimezone;

      // If mentioned location is different from user timezone
      const mentionedTz = TIMEZONE_ALIASES[mentioned.toLowerCase()];
      if (mentionedTz && mentionedTz !== resolvedTz) {
        ambiguities.push({
          field: 'timezone',
          type: AMBIGUITY_TYPES.MULTI_TIMEZONE_MEETING,
          value: mentioned,
          user_timezone: resolvedTz,
          mentioned_timezone: mentionedTz,
        });
      }
    }

    return ambiguities;
  }

  /**
   * Calculate risk score based on ambiguities and context
   */
  calculateRiskScore(ambiguities, context) {
    let baseRisk = 0;

    // Sum base risk from ambiguities
    for (const amb of ambiguities) {
      switch (amb.type) {
        case AMBIGUITY_TYPES.AM_PM_UNCLEAR:
          baseRisk += 0.3;
          break;
        case AMBIGUITY_TYPES.RELATIVE_WEEK_UNCLEAR:
          baseRisk += 0.3;
          break;
        case AMBIGUITY_TYPES.FUZZY_TIME:
          baseRisk += 0.1;
          break;
        case AMBIGUITY_TYPES.VAGUE_DURATION:
          baseRisk += 0.2;
          break;
        case AMBIGUITY_TYPES.TIMEZONE_AMBIGUOUS:
          baseRisk += 0.1;
          break;
        case AMBIGUITY_TYPES.MULTI_TIMEZONE_MEETING:
          baseRisk += 0.4;
          break;
        case AMBIGUITY_TYPES.DATE_UNCLEAR:
          baseRisk += 0.3;
          break;
        case AMBIGUITY_TYPES.YEAR_UNCLEAR:
          baseRisk += 0.1;
          break;
      }
    }

    // Apply multipliers
    let multiplier = 1.0;

    if (context.hasExternalAttendees) {
      multiplier *= RISK_MULTIPLIERS.external_attendees;
    }

    if (ambiguities.some(a => a.type === AMBIGUITY_TYPES.MULTI_TIMEZONE_MEETING)) {
      multiplier *= RISK_MULTIPLIERS.multi_timezone;
    }

    if (context.isIrreversible) {
      multiplier *= RISK_MULTIPLIERS.irreversible_action;
    }

    // Far future check would need resolved date
    // Business hours check would need resolved time

    return baseRisk * multiplier;
  }

  /**
   * Determine resolution strategy based on risk
   */
  determineStrategy(riskScore, ambiguities) {
    // Check for hard blockers (multi-timezone with no resolution)
    const hasMultiTz = ambiguities.some(a => a.type === AMBIGUITY_TYPES.MULTI_TIMEZONE_MEETING);

    if (riskScore > RISK_THRESHOLDS.EXPLICIT || hasMultiTz) {
      return {
        canProceed: false,
        confirmationLevel: 'explicit',
        reason: 'high_risk_requires_clarification',
      };
    }

    if (riskScore > RISK_THRESHOLDS.INLINE) {
      return {
        canProceed: true,
        confirmationLevel: 'inline',
        reason: 'medium_risk_confirm_inline',
      };
    }

    return {
      canProceed: true,
      confirmationLevel: 'silent',
      reason: 'low_risk_proceed_with_defaults',
    };
  }

  // ============================================
  // COMPONENT 4: Resolution Strategies
  // ============================================

  /**
   * Apply resolution strategies to resolve ambiguities
   */
  applyResolution(parsed, ambiguities, context, referenceDate, timezone) {
    const p = parsed.parsed;
    const now = referenceDate;
    const tz = timezone.timezone;

    // Resolve date
    let targetDate = this.resolveDate(p.date, now, context);

    // Resolve time
    let { hour, minute } = this.resolveTime(p.time, ambiguities, context, now);

    // Build the datetime
    const localDatetime = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      hour,
      minute,
      0
    );

    // Format as ISO local
    const localISO = this.formatLocalISO(localDatetime);

    // Calculate UTC (this would ideally use a proper timezone library)
    const utcISO = this.calculateUTC(localDatetime, tz);

    // DST info
    const dstInfo = this.getDSTInfo(localDatetime, tz);

    return {
      local: localISO,
      timezone: tz,
      utc: utcISO,
      utc_derived_at: new Date().toISOString(),
      dst_status: dstInfo.status,
      offset_at_time: dstInfo.offset,
      components: {
        year: localDatetime.getFullYear(),
        month: localDatetime.getMonth() + 1,
        day: localDatetime.getDate(),
        hour,
        minute,
        day_of_week: localDatetime.getDay(),
        day_name: DAY_NAMES[localDatetime.getDay()],
      },
      duration_minutes: p.duration.specified ? p.duration.minutes : 30,
      recurrence: p.recurrence.specified ? p.recurrence : null,
    };
  }

  /**
   * Resolve date component
   */
  resolveDate(dateComponent, referenceDate, context) {
    const now = new Date(referenceDate);

    if (dateComponent.type === 'explicit' && dateComponent.explicit_date) {
      const [year, month, day] = dateComponent.explicit_date.split('-').map(Number);
      return new Date(year, month - 1, day);
    }

    if (dateComponent.type === 'relative') {
      switch (dateComponent.reference) {
        case 'today':
          return new Date(now.getFullYear(), now.getMonth(), now.getDate());

        case 'tomorrow':
          return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

        case 'yesterday':
          return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

        case 'day_after_tomorrow':
          return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

        case 'in_days':
          return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dateComponent.modifier);

        case 'next_week':
          return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

        case 'this_week':
          // Return the same week's date (doesn't change the date)
          return new Date(now.getFullYear(), now.getMonth(), now.getDate());

        default:
          // Day of week resolution
          if (dateComponent.day_of_week !== null) {
            return this.resolveDayOfWeek(
              dateComponent.day_of_week,
              dateComponent.modifier,
              now,
              context.locale || this.locale
            );
          }
      }
    }

    // Default: today
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /**
   * Resolve day of week (e.g., "next Friday")
   */
  resolveDayOfWeek(targetDay, modifier, referenceDate, locale) {
    const currentDay = referenceDate.getDay();
    let daysToAdd = (targetDay - currentDay + 7) % 7;

    if (daysToAdd === 0 && !modifier) {
      // "Friday" on a Friday means next Friday
      daysToAdd = 7;
    }

    if (modifier === 'this') {
      // "this Friday" means this week
      if (daysToAdd === 0) {
        // Today
        return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
      }
      // This week's occurrence
      return new Date(
        referenceDate.getFullYear(),
        referenceDate.getMonth(),
        referenceDate.getDate() + daysToAdd
      );
    }

    if (modifier === 'next') {
      // Locale-dependent interpretation
      // US English: "next Friday" often means the coming Friday
      // UK English: "next Friday" means Friday of next week
      const isUSLocale = locale.toLowerCase().includes('us') || locale === 'en-US';

      if (isUSLocale) {
        // US: If the day is soon (within 2 days), add a week
        if (daysToAdd <= 2) {
          daysToAdd += 7;
        }
      } else {
        // UK/formal: Always means the following week
        if (daysToAdd <= 6) {
          daysToAdd += 7;
        }
      }
    }

    return new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate() + daysToAdd
    );
  }

  /**
   * Resolve time component with AM/PM heuristics
   */
  resolveTime(timeComponent, ambiguities, context, now) {
    let hour = 12;
    let minute = 0;

    if (timeComponent.type === 'explicit') {
      // Already resolved
      const [h, m] = timeComponent.explicit_time.split(':').map(Number);
      return { hour: h, minute: m };
    }

    if (timeComponent.type === 'relative') {
      // "in X hours" or fuzzy relative
      if (timeComponent.hours_from_now !== undefined) {
        const futureTime = new Date(now.getTime() + timeComponent.hours_from_now * 60 * 60 * 1000);
        return { hour: futureTime.getHours(), minute: futureTime.getMinutes() };
      }
      if (timeComponent.minutes_from_now !== undefined) {
        const futureTime = new Date(now.getTime() + timeComponent.minutes_from_now * 60 * 1000);
        return { hour: futureTime.getHours(), minute: futureTime.getMinutes() };
      }
    }

    if (timeComponent.type === 'fuzzy') {
      const config = FUZZY_TIME_DEFAULTS[timeComponent.fuzzy_name];
      if (config) {
        hour = context.isWorkContext ? (config.work_context_hour || config.default_hour) : config.default_hour;
        return { hour, minute: 0 };
      }
    }

    if (timeComponent.type === 'partial' || timeComponent.type === 'approximate') {
      hour = timeComponent.hour;
      minute = timeComponent.minute || 0;

      // Apply AM/PM heuristics
      const isAM = this.resolveAMPM(hour, context);
      if (!isAM && hour < 12) {
        hour += 12;
      }
      if (isAM && hour === 12) {
        hour = 0;
      }

      return { hour, minute };
    }

    // Default: noon
    return { hour: 12, minute: 0 };
  }

  /**
   * Resolve AM/PM based on heuristics
   */
  resolveAMPM(hour, context) {
    const input = (context.originalInput || '').toLowerCase();

    // Check for explicit morning/evening keywords
    if (MORNING_KEYWORDS.some(k => input.includes(k))) {
      return true; // AM
    }
    if (EVENING_KEYWORDS.some(k => input.includes(k))) {
      return false; // PM
    }

    // Hour-based defaults
    // 1-6: Usually PM (business hours)
    // 7-11: Usually AM (business hours)
    // 12: Noon (PM)
    if (hour >= 1 && hour <= 6) {
      return false; // PM
    }
    if (hour >= 7 && hour <= 11) {
      return true; // AM
    }
    if (hour === 12) {
      return false; // Noon = PM
    }

    // Default to PM for ambiguous cases
    return false;
  }

  /**
   * Format date as local ISO string
   */
  formatLocalISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }

  /**
   * Calculate UTC from local time and timezone
   * Note: In production, use a proper timezone library like luxon or moment-timezone
   */
  calculateUTC(localDatetime, timezone) {
    // Simplified: Use JS Date's UTC conversion
    // This doesn't handle all timezone nuances correctly
    // In production, use: luxon.DateTime.fromJSDate(localDatetime, { zone: timezone }).toUTC().toISO()

    // For now, return the ISO string with Z suffix
    // This is a simplification - real implementation needs timezone library
    return localDatetime.toISOString();
  }

  /**
   * Get DST information for a datetime and timezone
   */
  getDSTInfo(datetime, timezone) {
    // Simplified DST detection
    // In production, use a proper timezone library
    try {
      const options = { timeZone: timezone, timeZoneName: 'short' };
      const formatted = datetime.toLocaleString('en-US', options);
      const tzAbbrev = formatted.split(' ').pop();

      // Detect DST based on abbreviation (simplified)
      const isDST = /DT$|DST/i.test(tzAbbrev);

      // Get offset
      const offsetMinutes = datetime.getTimezoneOffset();
      const offsetHours = Math.abs(Math.floor(offsetMinutes / 60));
      const offsetMins = Math.abs(offsetMinutes % 60);
      const offsetSign = offsetMinutes <= 0 ? '+' : '-';
      const offset = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;

      return {
        status: isDST ? 'daylight' : 'standard',
        offset,
        abbreviation: tzAbbrev,
      };
    } catch (e) {
      return {
        status: 'unknown',
        offset: '+00:00',
        abbreviation: 'UTC',
      };
    }
  }

  // ============================================
  // COMPONENT 5: Clarification Generation
  // ============================================

  /**
   * Generate clarification questions for ambiguities
   */
  generateClarificationQuestions(ambiguities, parsed, context) {
    const questions = [];

    for (const amb of ambiguities) {
      switch (amb.type) {
        case AMBIGUITY_TYPES.AM_PM_UNCLEAR:
          questions.push({
            type: 'am_pm',
            question: `When you say "${amb.value}", did you mean ${amb.value}:00 AM or ${amb.value}:00 PM?`,
            options: [
              { label: `${amb.value}:00 AM`, value: 'am' },
              { label: `${amb.value}:00 PM`, value: 'pm' },
            ],
          });
          break;

        case AMBIGUITY_TYPES.RELATIVE_WEEK_UNCLEAR:
          const refDate = context.referenceDate || new Date();
          const candidates = this.getRelativeWeekCandidates(parsed.parsed.date, refDate);
          questions.push({
            type: 'relative_week',
            question: `When you say "${amb.value}", did you mean:`,
            options: candidates.map(c => ({
              label: `${c.label} (${c.date})`,
              value: c.date,
            })),
          });
          break;

        case AMBIGUITY_TYPES.MULTI_TIMEZONE_MEETING:
          const userTz = amb.user_timezone || context.userTimezone;
          const mentionedTz = amb.mentioned_timezone || amb.timezones?.[1];
          const hour = parsed.parsed.time.hour || 15;

          questions.push({
            type: 'timezone',
            question: `Should this be ${hour}:00 your time or ${hour}:00 ${amb.value || 'their'} time?`,
            options: [
              {
                label: `${hour}:00 your time (${this.getTimezoneAbbrev(userTz)})`,
                value: { timezone: userTz, hour },
              },
              {
                label: `${hour}:00 ${amb.value || 'their'} time (${this.getTimezoneAbbrev(mentionedTz)})`,
                value: { timezone: mentionedTz, hour },
              },
            ],
            additional_info: this.getTimezoneConversionInfo(hour, userTz, mentionedTz),
          });
          break;
      }
    }

    return questions;
  }

  /**
   * Get candidates for relative week ambiguity
   */
  getRelativeWeekCandidates(dateComponent, referenceDate) {
    if (!dateComponent.day_of_week) return [];

    const targetDay = dateComponent.day_of_week;
    const currentDay = referenceDate.getDay();
    const daysUntil = (targetDay - currentDay + 7) % 7 || 7;

    const thisWeek = new Date(referenceDate);
    thisWeek.setDate(thisWeek.getDate() + daysUntil);

    const nextWeek = new Date(thisWeek);
    nextWeek.setDate(nextWeek.getDate() + 7);

    return [
      {
        label: 'This coming ' + DAY_NAMES[targetDay],
        date: this.formatDateForDisplay(thisWeek),
      },
      {
        label: 'The following ' + DAY_NAMES[targetDay],
        date: this.formatDateForDisplay(nextWeek),
      },
    ];
  }

  /**
   * Get timezone abbreviation
   */
  getTimezoneAbbrev(timezone) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'short',
      });
      const parts = formatter.formatToParts(new Date());
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      return tzPart ? tzPart.value : timezone;
    } catch (e) {
      return timezone;
    }
  }

  /**
   * Get timezone conversion info for multi-tz meetings
   */
  getTimezoneConversionInfo(hour, tz1, tz2) {
    // Simplified conversion info
    // In production, calculate actual converted times
    return {
      note: `When it's ${hour}:00 in one timezone, it may be a different time in the other.`,
    };
  }

  // ============================================
  // COMPONENT 6: Confirmation Generation
  // ============================================

  /**
   * Generate human-readable confirmation
   */
  generateConfirmation(resolved, context, level) {
    if (level === 'silent') {
      return null;
    }

    const dayName = resolved.components.day_name.charAt(0).toUpperCase() + resolved.components.day_name.slice(1);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[resolved.components.month - 1];
    const day = resolved.components.day;
    const year = resolved.components.year;

    const hour12 = resolved.components.hour % 12 || 12;
    const period = resolved.components.hour < 12 ? 'AM' : 'PM';
    const minute = String(resolved.components.minute).padStart(2, '0');
    const timeStr = `${hour12}:${minute} ${period}`;

    const tzAbbrev = this.getTimezoneAbbrev(resolved.timezone);

    if (level === 'inline') {
      return {
        type: 'inline',
        message: `${dayName}, ${monthName} ${day} at ${timeStr} ${tzAbbrev}`,
      };
    }

    // Explicit confirmation
    const lines = [
      `📅 ${dayName}, ${monthName} ${day}, ${year}`,
      `⏰ ${timeStr} ${tzAbbrev}`,
    ];

    if (context.attendees && context.attendees.length > 0) {
      const attendeeList = context.attendees.map(a => a.email || a.name).join(', ');
      lines.push(`👥 ${attendeeList}`);
    }

    if (resolved.duration_minutes && resolved.duration_minutes !== 30) {
      lines.push(`⏱️ ${resolved.duration_minutes} minutes`);
    }

    if (resolved.dst_status === 'daylight') {
      lines.push(`ℹ️ Note: This is during Daylight Saving Time`);
    }

    return {
      type: 'explicit',
      message: lines.join('\n'),
      structured: {
        date: `${monthName} ${day}, ${year}`,
        time: `${timeStr} ${tzAbbrev}`,
        day_of_week: dayName,
        duration: resolved.duration_minutes,
      },
    };
  }

  /**
   * Format date for display
   */
  formatDateForDisplay(date) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[date.getMonth()]} ${date.getDate()}`;
  }

  // ============================================
  // UTILITY: Quick Resolution (backwards compatible)
  // ============================================

  /**
   * Quick normalize - simpler interface for basic cases
   * Returns ISO string or null
   */
  quickNormalize(input, options = {}) {
    const result = this.resolve(input, {
      userTimezone: options.timezone || this.defaultTimezone,
      referenceDate: options.referenceDate || new Date(),
      ...options,
    });

    if (result.success && result.resolved) {
      // Return ISO string with Z suffix for UTC
      return result.resolved.utc;
    }

    // If we can proceed with defaults despite ambiguities
    if (result.strategy?.canProceed && result.resolved) {
      return result.resolved.utc;
    }

    return null;
  }

  /**
   * Get full resolution result for API response
   */
  getFullResult(input, options = {}) {
    return this.resolve(input, options);
  }
}

// ============================================
// EXPORTS
// ============================================
module.exports = {
  TemporalResolver,
  FUZZY_TIME_DEFAULTS,
  TIMEZONE_ALIASES,
  AMBIGUITY_TYPES,
  RISK_THRESHOLDS,
};
