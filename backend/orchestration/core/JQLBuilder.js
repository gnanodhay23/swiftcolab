/**
 * JQLBuilder - Intelligent JQL construction with negation detection
 *
 * Handles user intent correctly, including:
 * - "all tickets" → no assignee filter
 * - "disregard assignee" → remove assignee filter
 * - "my tickets" → assignee = currentUser()
 * - Project, status, priority filters
 *
 * Prevents the common bug of filtering by assignee when user explicitly says not to.
 */

// Negation patterns for assignee
const ASSIGNEE_NEGATION_PATTERNS = [
  /disregard\s+(whom|who|which|what|the)?\s*(it'?s?\s+)?(assigned|assignee)/i,
  /ignore\s+(the\s+)?(assignee|assignment)/i,
  /regardless\s+of\s+(assignee|who)/i,
  /don'?t\s+(care|filter)\s+(about\s+)?(assignee|who)/i,
  /no\s+(assignee\s+)?filter/i,
  /without\s+(assignee\s+)?filter/i,
  /all\s+tickets?\s*(from|in|,|\.|\s|$)/i,
  /every\s+ticket/i,
  /any\s+ticket/i,
  /everyone'?s?\s+tickets?/i,
  /team\s+tickets?/i,
  /all\s+jira\s+(tickets?|issues?)/i,
];

// Patterns that indicate user wants their own tickets
const MY_TICKETS_PATTERNS = [
  /\b(my|mine)\s+(jira\s+)?(tickets?|issues?|tasks?)/i,
  /\bassigned\s+to\s+me\b/i,
  /\bi('?m|\s+am)\s+assigned/i,
  /\btickets?\s+(assigned\s+)?to\s+me\b/i,
];

// Project patterns
const PROJECT_PATTERNS = [
  /\b(?:project|in)\s+['"]?([A-Z][A-Z0-9_-]+)['"]?/i,
  /\b(?:from)\s+(?:project\s+)?['"]?([A-Z][A-Z0-9_-]+)['"]?/i,
  /\b([A-Z]{2,10})-\d+/,  // Matches PROJ-123 style keys
];

// Status patterns
const STATUS_PATTERNS = {
  open: [
    /\b(open|active|in\s*progress|to\s*do|pending)\s+(tickets?|issues?)?/i,
    /\b(not\s+)?(?:un)?done\b/i,
    /\bworking\s+on\b/i,
  ],
  closed: [
    /\b(closed|done|completed|resolved|finished)\s+(tickets?|issues?)?/i,
  ],
};

// Priority patterns
const PRIORITY_PATTERNS = {
  high: [/\b(high|critical|urgent|blocker)\s*(priority)?/i],
  medium: [/\b(medium|normal)\s*(priority)?/i],
  low: [/\b(low|minor|trivial)\s*(priority)?/i],
};

class JQLBuilder {
  constructor() {
    this.reset();
  }

  reset() {
    this.conditions = [];
    this.orderBy = 'ORDER BY updated DESC';
    this.wantsAllTickets = false;
    this.detectedIntent = {};
  }

  /**
   * Build JQL from user message
   * @param {string} message - User's natural language message
   * @param {object} context - Optional context (project from conversation, etc.)
   * @returns {object} - { jql: string, intent: object, warnings: string[] }
   */
  buildFromMessage(message, context = {}) {
    this.reset();
    const warnings = [];

    if (!message) {
      return {
        jql: `project IS NOT EMPTY ${this.orderBy}`,
        intent: { type: 'all_tickets' },
        warnings: ['No message provided, fetching all accessible tickets'],
      };
    }

    // Step 1: Check for assignee negation FIRST (this is critical)
    this.wantsAllTickets = this._checkAssigneeNegation(message);
    if (this.wantsAllTickets) {
      this.detectedIntent.assignee = 'all';
      console.log('[JQLBuilder] Detected assignee negation - user wants ALL tickets');
    }

    // Step 2: Check if user explicitly wants their tickets
    const wantsMyTickets = !this.wantsAllTickets && this._checkMyTickets(message);
    if (wantsMyTickets) {
      this.conditions.push('assignee = currentUser()');
      this.detectedIntent.assignee = 'me';
    }

    // Step 3: Extract project
    const project = this._extractProject(message) || context.defaultProject;
    if (project) {
      this.conditions.push(`project = "${project}"`);
      this.detectedIntent.project = project;
    }

    // Step 4: Extract status
    const status = this._extractStatus(message);
    if (status) {
      if (status === 'open') {
        this.conditions.push('status NOT IN ("Done", "Closed", "Resolved")');
      } else if (status === 'closed') {
        this.conditions.push('status IN ("Done", "Closed", "Resolved")');
      }
      this.detectedIntent.status = status;
    }

    // Step 5: Extract priority
    const priority = this._extractPriority(message);
    if (priority) {
      this.conditions.push(`priority = "${priority}"`);
      this.detectedIntent.priority = priority;
    }

    // Step 6: Check for specific ticket reference
    const ticketKey = this._extractTicketKey(message);
    if (ticketKey) {
      // If user mentions specific ticket, that takes precedence
      this.conditions = [`key = "${ticketKey}"`];
      this.detectedIntent.specificTicket = ticketKey;
    }

    // Step 7: Build final JQL
    let jql;
    if (this.conditions.length === 0) {
      // No specific conditions - get all accessible tickets
      jql = `project IS NOT EMPTY ${this.orderBy}`;
    } else {
      jql = `${this.conditions.join(' AND ')} ${this.orderBy}`;
    }

    // Add warnings if we're doing something potentially unexpected
    if (this.wantsAllTickets && !project) {
      warnings.push('Fetching ALL tickets across all projects - this may return many results');
    }

    return {
      jql,
      intent: this.detectedIntent,
      warnings,
    };
  }

  /**
   * Check if user wants to ignore assignee filter
   */
  _checkAssigneeNegation(message) {
    for (const pattern of ASSIGNEE_NEGATION_PATTERNS) {
      if (pattern.test(message)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if user wants their own tickets
   */
  _checkMyTickets(message) {
    for (const pattern of MY_TICKETS_PATTERNS) {
      if (pattern.test(message)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Extract project from message
   */
  _extractProject(message) {
    for (const pattern of PROJECT_PATTERNS) {
      const match = message.match(pattern);
      if (match) {
        // For ticket key pattern, extract project prefix
        if (match[0].includes('-')) {
          return match[0].split('-')[0];
        }
        return match[1]?.toUpperCase();
      }
    }
    return null;
  }

  /**
   * Extract status from message
   */
  _extractStatus(message) {
    for (const [status, patterns] of Object.entries(STATUS_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          // Check for negation like "not done" which means open
          if (status === 'closed' && /\bnot\s+/i.test(message)) {
            return 'open';
          }
          return status;
        }
      }
    }
    return null;
  }

  /**
   * Extract priority from message
   */
  _extractPriority(message) {
    for (const [priority, patterns] of Object.entries(PRIORITY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          return priority.charAt(0).toUpperCase() + priority.slice(1);
        }
      }
    }
    return null;
  }

  /**
   * Extract specific ticket key from message
   */
  _extractTicketKey(message) {
    const match = message.match(/\b([A-Z]{2,10}-\d+)\b/);
    return match ? match[1] : null;
  }

  /**
   * Validate and potentially fix existing JQL based on user message
   * Useful when JQL is already generated but might be wrong
   */
  validateAndFix(jql, message) {
    const wantsAll = this._checkAssigneeNegation(message);

    if (wantsAll && jql.includes('assignee')) {
      // User said to disregard assignee but JQL has it - remove it
      console.log('[JQLBuilder] Removing assignee filter due to user intent');

      // Remove assignee conditions
      let fixed = jql
        .replace(/\s*AND\s*assignee\s*=\s*[^AND]+/gi, '')
        .replace(/assignee\s*=\s*[^AND]+\s*AND\s*/gi, '')
        .replace(/^assignee\s*=\s*[^ORDER]+/gi, '')
        .trim();

      // Clean up orphaned ANDs
      fixed = fixed.replace(/^\s*AND\s+/i, '').replace(/\s+AND\s*$/i, '');

      // If we removed everything, return basic query
      if (!fixed || fixed === 'ORDER BY updated DESC') {
        return `project IS NOT EMPTY ORDER BY updated DESC`;
      }

      // Make sure ORDER BY is present
      if (!fixed.includes('ORDER BY')) {
        fixed += ' ORDER BY updated DESC';
      }

      return fixed;
    }

    return jql;
  }
}

// Singleton instance
const jqlBuilder = new JQLBuilder();

// Helper function for quick usage
function buildJQL(message, context = {}) {
  return jqlBuilder.buildFromMessage(message, context);
}

function validateJQL(jql, message) {
  return jqlBuilder.validateAndFix(jql, message);
}

module.exports = {
  JQLBuilder,
  buildJQL,
  validateJQL,
  // Export patterns for testing
  ASSIGNEE_NEGATION_PATTERNS,
  MY_TICKETS_PATTERNS,
};
