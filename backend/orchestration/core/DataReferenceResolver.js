/**
 * DataReferenceResolver - Resolves references to previously fetched data
 *
 * Handles patterns like:
 * - "send those" → use previously fetched tickets
 * - "those tickets" → reference to last Jira search
 * - "the emails" → reference to last email search
 * - "them" → context-dependent reference
 *
 * Prevents unnecessary API calls by using cached conversation data.
 */

// Patterns that indicate reference to previous data
const DATA_REFERENCE_PATTERNS = {
  // Jira ticket references
  jira: [
    /\b(?:those|these|the)\s+(?:jira\s+)?(?:tickets?|issues?|tasks?)\b/i,
    /\bsend\s+(?:those|these|them)\b/i,
    /\b(?:use|take|include)\s+(?:those|these|the)\s+(?:tickets?|issues?)\b/i,
    /\b(?:email|send|share)\s+(?:the\s+)?(?:results?|tickets?|issues?)\b/i,
    /\btickets?\s+(?:i\s+)?(?:just\s+)?(?:got|found|searched|retrieved)/i,
    /\bresults?\s+(?:from|of)\s+(?:the\s+)?(?:search|query)/i,
  ],

  // Email references
  email: [
    /\b(?:those|these|the)\s+(?:emails?|messages?)\b/i,
    /\b(?:forward|reply\s+to|respond\s+to)\s+(?:them|those|these)\b/i,
    /\bemails?\s+(?:i\s+)?(?:just\s+)?(?:got|found|searched)/i,
  ],

  // Calendar event references
  calendar: [
    /\b(?:those|these|the)\s+(?:events?|meetings?|appointments?)\b/i,
    /\b(?:reschedule|move|update)\s+(?:those|these|them)\b/i,
    /\bevents?\s+(?:i\s+)?(?:just\s+)?(?:found|searched)/i,
  ],

  // Slack message references
  slack: [
    /\b(?:those|these|the)\s+(?:messages?|posts?)\b/i,
    /\b(?:slack\s+)?(?:messages?|posts?)\s+(?:i\s+)?(?:found|searched)/i,
  ],

  // Generic "them" / "those" / "these"
  generic: [
    /\bsend\s+(?:them|those|these)\b/i,
    /\bshare\s+(?:them|those|these)\b/i,
    /\bforward\s+(?:them|those|these)\b/i,
    /\buse\s+(?:them|those|these)\b/i,
    /\binclude\s+(?:them|those|these)\b/i,
  ],
};

// Map data types to their cache keys
const DATA_TYPE_CACHE_KEYS = {
  jira: 'JIRA_SEARCH_ISSUES',
  email: 'GMAIL_FETCH_EMAILS',
  calendar: 'GOOGLECALENDAR_GET_EVENTS',
  slack: 'SLACK_SEARCH_MESSAGES',
};

// Action dependencies - what data each action needs
const ACTION_DATA_REQUIREMENTS = {
  'GMAIL_SEND_EMAIL': ['jira', 'calendar', 'slack'],  // Can include any of these in email
  'SLACK_SEND_MESSAGE': ['jira', 'calendar', 'email'],
  'SLACK_SEND_CHANNEL_MESSAGE': ['jira', 'calendar', 'email'],
  'GOOGLECALENDAR_CREATE_EVENT': ['jira'],  // Might reference tickets
};

class DataReferenceResolver {
  constructor(contextMemoryCache) {
    this.contextMemoryCache = contextMemoryCache;
    this.patterns = DATA_REFERENCE_PATTERNS;
    this.cacheKeys = DATA_TYPE_CACHE_KEYS;
    this.actionRequirements = ACTION_DATA_REQUIREMENTS;
  }

  /**
   * Check if message contains references to previously fetched data
   */
  hasDataReferences(message) {
    if (!message) return false;

    for (const patterns of Object.values(this.patterns)) {
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Detect what type of data is being referenced
   * @returns {string[]} Array of data types (e.g., ['jira', 'email'])
   */
  detectReferencedTypes(message) {
    if (!message) return [];

    const types = [];

    for (const [type, patterns] of Object.entries(this.patterns)) {
      if (type === 'generic') continue;

      for (const pattern of patterns) {
        if (pattern.test(message)) {
          if (!types.includes(type)) {
            types.push(type);
          }
          break;
        }
      }
    }

    // If only generic patterns matched, infer from context
    if (types.length === 0) {
      for (const pattern of this.patterns.generic) {
        if (pattern.test(message)) {
          // Generic reference - will need to infer from available data
          return ['_generic'];
        }
      }
    }

    return types;
  }

  /**
   * Resolve data references from conversation memory
   *
   * @param {string} message - User message
   * @param {string} entityId - Entity ID
   * @param {string} conversationId - Conversation ID
   * @param {string[]} targetActions - Actions being planned
   * @returns {object} - { resolved, data, dataType, useCachedData, skipActions }
   */
  async resolve(message, entityId, conversationId, targetActions = []) {
    const result = {
      resolved: false,
      data: null,
      dataType: null,
      useCachedData: false,
      skipActions: [],      // Actions that can be skipped (data already available)
      injectData: null,     // Data to inject into downstream tasks
      itemCount: 0,
    };

    if (!this.hasDataReferences(message)) {
      return result;
    }

    const referencedTypes = this.detectReferencedTypes(message);
    console.log('[DataReferenceResolver] Detected references:', referencedTypes);

    if (referencedTypes.length === 0) {
      return result;
    }

    // Get stored data from context memory
    const storedData = await this._getStoredData(entityId, conversationId);

    if (!storedData || Object.keys(storedData).length === 0) {
      console.log('[DataReferenceResolver] No stored data available');
      return result;
    }

    // Resolve based on referenced types
    for (const type of referencedTypes) {
      const resolvedData = await this._resolveType(type, storedData, targetActions);

      if (resolvedData.data) {
        result.resolved = true;
        result.data = resolvedData.data;
        result.dataType = type === '_generic' ? resolvedData.inferredType : type;
        result.useCachedData = true;
        result.skipActions = resolvedData.skipActions || [];
        result.injectData = resolvedData.data;
        result.itemCount = Array.isArray(resolvedData.data) ? resolvedData.data.length :
          resolvedData.data?.issues?.length || resolvedData.data?.data?.length || 1;

        console.log(`[DataReferenceResolver] Resolved ${result.dataType} with ${result.itemCount} items`);
        break;  // Use first match
      }
    }

    return result;
  }

  /**
   * Get stored data from context memory
   */
  async _getStoredData(entityId, conversationId) {
    if (!this.contextMemoryCache) {
      return {};
    }

    try {
      // Get all stored action results
      const allParams = await this.contextMemoryCache.getAllStoredActionParams(entityId, conversationId);

      // Also try to get specific result data
      const context = await this.contextMemoryCache.getContext(entityId, conversationId);

      return {
        actionParams: allParams,
        actionResults: context.actionResults || [],
        objectIds: context.objectIds || {},
        // Check for specific cached results
        lastJiraResults: context.lastResult_JIRA_SEARCH_ISSUES?.data ||
          context.lastResult_JIRA_GET_ISSUES?.data,
        lastEmailResults: context.lastResult_GMAIL_FETCH_EMAILS?.data,
        lastCalendarResults: context.lastResult_GOOGLECALENDAR_GET_EVENTS?.data,
        lastSlackResults: context.lastResult_SLACK_SEARCH_MESSAGES?.data,
      };
    } catch (error) {
      console.error('[DataReferenceResolver] Error getting stored data:', error.message);
      return {};
    }
  }

  /**
   * Resolve a specific data type
   */
  async _resolveType(type, storedData, targetActions) {
    let data = null;
    let inferredType = null;
    const skipActions = [];

    switch (type) {
      case 'jira':
        data = this._extractJiraData(storedData);
        if (data) {
          // Skip Jira search if we already have data
          skipActions.push('JIRA_SEARCH_ISSUES', 'JIRA_GET_ISSUES');
        }
        break;

      case 'email':
        data = this._extractEmailData(storedData);
        if (data) {
          skipActions.push('GMAIL_FETCH_EMAILS', 'GMAIL_FIND_EMAIL');
        }
        break;

      case 'calendar':
        data = this._extractCalendarData(storedData);
        if (data) {
          skipActions.push('GOOGLECALENDAR_GET_EVENTS', 'GOOGLECALENDAR_FIND_EVENT');
        }
        break;

      case 'slack':
        data = this._extractSlackData(storedData);
        if (data) {
          skipActions.push('SLACK_SEARCH_MESSAGES');
        }
        break;

      case '_generic':
        // Infer from target actions and available data
        const inference = this._inferDataType(targetActions, storedData);
        data = inference.data;
        inferredType = inference.type;
        skipActions.push(...(inference.skipActions || []));
        break;
    }

    return { data, skipActions, inferredType };
  }

  /**
   * Extract Jira data from stored results
   */
  _extractJiraData(storedData) {
    // Check dedicated result storage
    if (storedData.lastJiraResults?.issues) {
      return storedData.lastJiraResults;
    }

    // Check action params for result
    const jiraParams = storedData.actionParams?.JIRA_SEARCH_ISSUES;
    if (jiraParams?.result?.issues) {
      return jiraParams.result;
    }

    // Check action results array
    for (const result of (storedData.actionResults || [])) {
      if (result.action?.includes('JIRA') && result.data?.issues) {
        return result.data;
      }
    }

    return null;
  }

  /**
   * Extract email data from stored results
   */
  _extractEmailData(storedData) {
    if (storedData.lastEmailResults?.messages) {
      return storedData.lastEmailResults;
    }

    const emailParams = storedData.actionParams?.GMAIL_FETCH_EMAILS;
    if (emailParams?.result?.messages) {
      return emailParams.result;
    }

    return null;
  }

  /**
   * Extract calendar data from stored results
   */
  _extractCalendarData(storedData) {
    if (storedData.lastCalendarResults?.items) {
      return storedData.lastCalendarResults;
    }

    const calParams = storedData.actionParams?.GOOGLECALENDAR_GET_EVENTS;
    if (calParams?.result?.items) {
      return calParams.result;
    }

    return null;
  }

  /**
   * Extract Slack data from stored results
   */
  _extractSlackData(storedData) {
    if (storedData.lastSlackResults?.messages) {
      return storedData.lastSlackResults;
    }

    const slackParams = storedData.actionParams?.SLACK_SEARCH_MESSAGES;
    if (slackParams?.result?.messages) {
      return slackParams.result;
    }

    return null;
  }

  /**
   * Infer data type from target actions
   */
  _inferDataType(targetActions, storedData) {
    // If sending email, most likely wants to send Jira/calendar data
    if (targetActions.some(a => a.includes('GMAIL_SEND'))) {
      // Check what data is available
      const jiraData = this._extractJiraData(storedData);
      if (jiraData) {
        return {
          type: 'jira',
          data: jiraData,
          skipActions: ['JIRA_SEARCH_ISSUES', 'JIRA_GET_ISSUES'],
        };
      }

      const calendarData = this._extractCalendarData(storedData);
      if (calendarData) {
        return {
          type: 'calendar',
          data: calendarData,
          skipActions: ['GOOGLECALENDAR_GET_EVENTS'],
        };
      }
    }

    // If posting to Slack, check for available data
    if (targetActions.some(a => a.includes('SLACK'))) {
      const jiraData = this._extractJiraData(storedData);
      if (jiraData) {
        return {
          type: 'jira',
          data: jiraData,
          skipActions: ['JIRA_SEARCH_ISSUES'],
        };
      }
    }

    // Default: return most recent data
    const jiraData = this._extractJiraData(storedData);
    if (jiraData) {
      return { type: 'jira', data: jiraData, skipActions: ['JIRA_SEARCH_ISSUES'] };
    }

    const emailData = this._extractEmailData(storedData);
    if (emailData) {
      return { type: 'email', data: emailData, skipActions: ['GMAIL_FETCH_EMAILS'] };
    }

    return { type: null, data: null, skipActions: [] };
  }

  /**
   * Check if a search action can be skipped due to cached data
   */
  canSkipSearch(action, entityId, conversationId) {
    const searchActions = [
      'JIRA_SEARCH_ISSUES',
      'JIRA_GET_ISSUES',
      'GMAIL_FETCH_EMAILS',
      'GOOGLECALENDAR_GET_EVENTS',
      'SLACK_SEARCH_MESSAGES',
    ];

    return searchActions.includes(action);
  }
}

module.exports = { DataReferenceResolver, DATA_REFERENCE_PATTERNS };
