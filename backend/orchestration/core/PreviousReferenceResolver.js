/**
 * PreviousReferenceResolver - Resolves "same", "previous", "last" references
 *
 * Handles patterns like:
 * - "same email" → previous recipient
 * - "previous subject" → previous email subject
 * - "last channel" → previous Slack channel
 * - "same project" → previous Jira project
 * - "that calendar" → previous calendar event details
 *
 * Works with ContextMemoryCache to look up stored action results.
 */

// Reference patterns for different services
const REFERENCE_PATTERNS = {
  // Email references
  email: {
    recipient: [
      /(?:same|previous|last|that)\s*(?:email|recipient|person|address)/i,
      /(?:send\s+)?(?:to\s+)?(?:the\s+)?same\s+(?:person|email)/i,
      /(?:to\s+)?(?:them|him|her)\s+again/i,
    ],
    subject: [
      /(?:same|previous|last)\s*(?:subject|sub|title)/i,
      /(?:with\s+)?(?:the\s+)?same\s+(?:subject|sub)/i,
      /(?:re|regarding|about)\s*:\s*(?:same|previous)/i,
      // Handle variations: "sub used previously", "same sub as before"
      /\b(?:sub|subject)\s+(?:used\s+)?(?:previously|before|last\s*time|earlier)/i,
      /\buse\s+(?:the\s+)?(?:same|previous|last)\s+(?:sub|subject)/i,
      /\bsame\s+sub(?:ject)?\s+(?:as\s+)?(?:before|previously|last)/i,
      /\bprevious(?:ly)?\s+used\s+(?:sub|subject)/i,
      // Handle typos: "saem sub", "samw sub"
      /\b(?:saem|samw|smae)\s+(?:sub|subject)/i,
    ],
    body: [
      /(?:same|previous|last)\s*(?:body|content|message|text)/i,
    ],
  },

  // Slack references
  slack: {
    channel: [
      /(?:same|previous|last|that)\s*(?:channel|slack\s*channel)/i,
      /(?:post\s+)?(?:to\s+)?(?:the\s+)?same\s+(?:channel|place)/i,
    ],
    message: [
      /(?:same|previous|last)\s*(?:message|msg)/i,
    ],
  },

  // Jira references
  jira: {
    project: [
      /(?:same|previous|last|that)\s*(?:project|jira\s*project)/i,
      /(?:in\s+)?(?:the\s+)?same\s+project/i,
    ],
    issue: [
      /(?:same|previous|last|that)\s*(?:issue|ticket|task)/i,
      /(?:update\s+)?(?:the\s+)?same\s+(?:issue|ticket)/i,
    ],
    assignee: [
      /(?:same|previous|last)\s*(?:assignee|person|user)/i,
      /(?:assign\s+)?(?:to\s+)?(?:the\s+)?same\s+(?:person|user)/i,
    ],
  },

  // Calendar references
  calendar: {
    attendees: [
      /(?:same|previous|last)\s*(?:attendees|people|participants|invitees)/i,
      /(?:with\s+)?(?:the\s+)?same\s+(?:people|attendees)/i,
    ],
    time: [
      /(?:same|previous|last)\s*(?:time|hour)/i,
      /(?:at\s+)?(?:the\s+)?same\s+time/i,
    ],
    duration: [
      /(?:same|previous|last)\s*(?:duration|length)/i,
    ],
    location: [
      /(?:same|previous|last)\s*(?:location|place|room)/i,
    ],
  },

  // Frappe references
  frappe: {
    doctype: [
      /(?:same|previous|last|that)\s*(?:doctype|document\s*type)/i,
    ],
    document: [
      /(?:same|previous|last|that)\s*(?:document|doc|record)/i,
    ],
    workspace: [
      /(?:same|previous|last)\s*(?:workspace|site)/i,
    ],
  },

  // Generic "all" or "everything"
  generic: {
    all: [
      /(?:all|every(?:thing)?)\s*(?:the\s+)?same/i,
      /(?:same|previous)\s+(?:details|params|parameters|settings)/i,
      /(?:like|as)\s+(?:before|last\s+time|previously)/i,
    ],
  },
};

// Action to stored params mapping
const ACTION_PARAM_MAP = {
  // Gmail
  GMAIL_SEND_EMAIL: {
    storedParams: ['to', 'subject', 'body', 'cc', 'bcc'],
    references: {
      recipient: 'to',
      subject: 'subject',
      body: 'body',
    },
  },
  GMAIL_FETCH_EMAILS: {
    storedParams: ['query', 'maxResults'],
    references: {},
  },

  // Slack
  SLACK_SEND_CHANNEL_MESSAGE: {
    storedParams: ['channel', 'channel_id', 'message', 'thread_ts'],
    references: {
      channel: 'channel',
      message: 'message',
    },
  },
  SLACK_SEND_MESSAGE: {
    storedParams: ['channel', 'message'],
    references: {
      channel: 'channel',
      message: 'message',
    },
  },

  // Jira
  JIRA_SEARCH_ISSUES: {
    storedParams: ['jql', 'project_key', 'maxResults'],
    references: {
      project: 'project_key',
    },
  },
  JIRA_CREATE_ISSUE: {
    storedParams: ['project_key', 'summary', 'description', 'issue_type', 'assignee', 'priority'],
    references: {
      project: 'project_key',
      assignee: 'assignee',
    },
  },
  JIRA_UPDATE_ISSUE: {
    storedParams: ['issue_key', 'summary', 'description'],
    references: {
      issue: 'issue_key',
    },
  },

  // Google Calendar
  GOOGLECALENDAR_CREATE_EVENT: {
    storedParams: ['summary', 'description', 'start_datetime', 'end_datetime', 'attendees', 'location', 'calendar_id'],
    references: {
      attendees: 'attendees',
      time: 'start_datetime',
      duration: '_duration_minutes',
      location: 'location',
    },
  },
  GOOGLECALENDAR_FIND_EVENT: {
    storedParams: ['timeMin', 'timeMax', 'calendar_id', 'q'],
    references: {},
  },

  // Frappe
  FRAPPE_CREATE_DOCUMENT: {
    storedParams: ['doctype', 'data', 'site'],
    references: {
      doctype: 'doctype',
      workspace: 'site',
    },
  },
  FRAPPE_GET_DOCUMENT: {
    storedParams: ['doctype', 'name', 'site'],
    references: {
      doctype: 'doctype',
      document: 'name',
    },
  },
  FRAPPE_UPDATE_DOCUMENT: {
    storedParams: ['doctype', 'name', 'data', 'site'],
    references: {
      doctype: 'doctype',
      document: 'name',
    },
  },
};

class PreviousReferenceResolver {
  constructor() {
    this.patterns = REFERENCE_PATTERNS;
    this.actionParamMap = ACTION_PARAM_MAP;
  }

  /**
   * Parse message for previous/same/last references
   * Returns: { hasReferences: boolean, references: { type: field[] }, serviceHints: string[] }
   */
  parseReferences(message) {
    const result = {
      hasReferences: false,
      references: {},
      serviceHints: [],
      genericAll: false,
    };

    if (!message) return result;

    const msgLower = message.toLowerCase();

    // Check for generic "all same" pattern
    for (const pattern of this.patterns.generic.all) {
      if (pattern.test(msgLower)) {
        result.genericAll = true;
        result.hasReferences = true;
        break;
      }
    }

    // Check each service
    for (const [service, fields] of Object.entries(this.patterns)) {
      if (service === 'generic') continue;

      for (const [field, patterns] of Object.entries(fields)) {
        for (const pattern of patterns) {
          if (pattern.test(msgLower)) {
            if (!result.references[service]) {
              result.references[service] = [];
            }
            if (!result.references[service].includes(field)) {
              result.references[service].push(field);
            }
            if (!result.serviceHints.includes(service)) {
              result.serviceHints.push(service);
            }
            result.hasReferences = true;
          }
        }
      }
    }

    return result;
  }

  /**
   * Resolve references from stored context
   * @param {string} message - User message
   * @param {string[]} targetActions - Actions being performed (e.g., ['GMAIL_SEND_EMAIL'])
   * @param {object} storedActions - Previously stored action results { actionName: { params, result, timestamp } }
   * @returns {object} - { resolvedParams: {}, unresolvedRefs: [], usedFrom: {} }
   */
  resolveFromContext(message, targetActions, storedActions) {
    const result = {
      resolvedParams: {},
      unresolvedRefs: [],
      usedFrom: {},
    };

    if (!storedActions || Object.keys(storedActions).length === 0) {
      return result;
    }

    const parsed = this.parseReferences(message);
    if (!parsed.hasReferences) {
      return result;
    }

    console.log('[PreviousReferenceResolver] Parsed references:', parsed);

    for (const targetAction of targetActions) {
      const actionConfig = this.actionParamMap[targetAction];
      if (!actionConfig) continue;

      // Determine which service this action belongs to
      const service = this._getServiceFromAction(targetAction);

      // If generic "all same" is requested, try to copy all params from previous similar action
      if (parsed.genericAll) {
        const previousParams = this._findPreviousActionParams(targetAction, storedActions);
        if (previousParams) {
          for (const param of actionConfig.storedParams) {
            if (previousParams[param] !== undefined) {
              result.resolvedParams[param] = previousParams[param];
              result.usedFrom[param] = `previous ${targetAction}`;
            }
          }
        }
      }

      // Handle specific field references
      const serviceRefs = parsed.references[service] || [];
      for (const fieldRef of serviceRefs) {
        const paramName = actionConfig.references[fieldRef];
        if (!paramName) continue;

        // Find the value from previous action
        const value = this._findParamValue(paramName, targetAction, storedActions);
        if (value !== null && value !== undefined) {
          result.resolvedParams[paramName] = value;
          result.usedFrom[paramName] = `previous ${fieldRef}`;
        } else {
          result.unresolvedRefs.push({ field: fieldRef, param: paramName });
        }
      }

      // Cross-service resolution (e.g., "same email" for Gmail from any previous email action)
      if (parsed.references.email && service !== 'email') {
        // User mentioned email but action is different - might want to use email from previous
        const emailRefs = parsed.references.email;
        if (emailRefs.includes('recipient')) {
          const prevEmail = this._findPreviousActionParams('GMAIL_SEND_EMAIL', storedActions);
          if (prevEmail?.to) {
            // Map to appropriate param for this action
            if (targetAction.includes('CALENDAR') && !result.resolvedParams.attendees) {
              result.resolvedParams.attendees = Array.isArray(prevEmail.to) ? prevEmail.to : [prevEmail.to];
              result.usedFrom.attendees = 'previous email recipient';
            }
          }
        }
      }
    }

    console.log('[PreviousReferenceResolver] Resolved:', result.resolvedParams);
    return result;
  }

  /**
   * Get service name from action
   */
  _getServiceFromAction(action) {
    if (action.includes('GMAIL')) return 'email';
    if (action.includes('SLACK')) return 'slack';
    if (action.includes('JIRA')) return 'jira';
    if (action.includes('CALENDAR')) return 'calendar';
    if (action.includes('FRAPPE')) return 'frappe';
    if (action.includes('TRELLO')) return 'trello';
    return 'unknown';
  }

  /**
   * Find previous action params from stored actions
   */
  _findPreviousActionParams(targetAction, storedActions) {
    // Direct match
    if (storedActions[targetAction]?.params) {
      return storedActions[targetAction].params;
    }

    // Look for similar actions (same service)
    const service = this._getServiceFromAction(targetAction);
    for (const [action, data] of Object.entries(storedActions)) {
      if (this._getServiceFromAction(action) === service && data?.params) {
        return data.params;
      }
    }

    return null;
  }

  /**
   * Find a specific param value from stored actions
   */
  _findParamValue(paramName, targetAction, storedActions) {
    // First try the exact action
    if (storedActions[targetAction]?.params?.[paramName] !== undefined) {
      return storedActions[targetAction].params[paramName];
    }

    // Try same-service actions
    const service = this._getServiceFromAction(targetAction);
    for (const [action, data] of Object.entries(storedActions)) {
      if (this._getServiceFromAction(action) === service) {
        if (data?.params?.[paramName] !== undefined) {
          return data.params[paramName];
        }
      }
    }

    // Try to find in result data (e.g., created issue key)
    for (const [action, data] of Object.entries(storedActions)) {
      if (data?.result?.[paramName] !== undefined) {
        return data.result[paramName];
      }
      if (data?.result?.data?.[paramName] !== undefined) {
        return data.result.data[paramName];
      }
    }

    return null;
  }

  /**
   * Get hint text for unresolved references
   */
  getUnresolvedHint(unresolvedRefs) {
    if (unresolvedRefs.length === 0) return null;

    const hints = unresolvedRefs.map(ref => {
      switch (ref.field) {
        case 'recipient':
          return "I don't have a previous email recipient stored. Who should I send to?";
        case 'subject':
          return "I don't have a previous email subject. What should the subject be?";
        case 'channel':
          return "I don't have a previous Slack channel. Which channel?";
        case 'project':
          return "I don't have a previous Jira project. Which project?";
        default:
          return `I couldn't find a previous ${ref.field}. Please specify.`;
      }
    });

    return hints.join('\n');
  }

  /**
   * Check if message contains any "previous" type references
   */
  hasPreviousReferences(message) {
    if (!message) return false;
    const parsed = this.parseReferences(message);
    return parsed.hasReferences;
  }

  /**
   * Get all storable params for an action (for saving after execution)
   */
  getStorableParams(action) {
    return this.actionParamMap[action]?.storedParams || [];
  }
}

module.exports = { PreviousReferenceResolver, REFERENCE_PATTERNS, ACTION_PARAM_MAP };
