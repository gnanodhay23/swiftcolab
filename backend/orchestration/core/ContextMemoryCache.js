/**
 * ContextMemoryCache - Intelligent context caching for slot filling
 *
 * Features:
 * - Caches conversation context and extracted entities
 * - Re-scans context before asking questions
 * - Fills slots from cached data
 * - Stores action results with object IDs
 * - Redis-backed with in-memory fallback
 */

const redis = require('../../services/redis');

// Entity extraction patterns
const ENTITY_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(\+?1?[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
  date: /\b(today|tomorrow|yesterday|next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this\s+(week|month)|(\d{1,2})[\/\-](\d{1,2})[\/\-]?(\d{2,4})?)\b/gi,
  time: /\b(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?|noon|midnight|(morning|afternoon|evening)\b/gi,
  duration: /\b(\d+)\s*(hour|hr|minute|min|day|week|month)s?\b/gi,
  url: /https?:\/\/[^\s]+/g,
  slackChannel: /(#[a-z0-9_-]+|<#[A-Z0-9]+\|[^>]+>)/gi,
  jiraKey: /\b[A-Z][A-Z0-9]+-\d+\b/g,
  priority: /\b(high|medium|low|critical|urgent|blocker)\b/gi,
  person: /\b(with\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
};

// Time expressions to absolute dates
const TIME_MAPPINGS = {
  'today': () => new Date(),
  'tomorrow': () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  },
  'yesterday': () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  },
  'this week': () => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  },
  'next week': () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  },
};

class ContextMemoryCache {
  constructor() {
    // In-memory fallback when Redis unavailable
    this.memoryCache = new Map();
    this.TTL = 3600; // 1 hour default TTL
  }

  /**
   * Get cache key for a user/conversation
   */
  _getKey(entityId, conversationId = 'default') {
    return `context:${entityId}:${conversationId}`;
  }

  /**
   * Get cached context for a user
   */
  async getContext(entityId, conversationId = 'default') {
    const key = this._getKey(entityId, conversationId);

    if (redis.isAvailable()) {
      const data = await redis.get(key);
      return data || this._createEmptyContext();
    }

    return this.memoryCache.get(key) || this._createEmptyContext();
  }

  /**
   * Save context
   */
  async saveContext(entityId, context, conversationId = 'default') {
    const key = this._getKey(entityId, conversationId);
    context.updatedAt = Date.now();

    if (redis.isAvailable()) {
      await redis.set(key, context, this.TTL);
    } else {
      this.memoryCache.set(key, context);
    }
  }

  /**
   * Create empty context structure
   */
  _createEmptyContext() {
    return {
      messages: [],           // Recent messages
      entities: {},           // Extracted entities by type
      actionResults: [],      // Results from previous actions
      objectIds: {},          // Stored object IDs (event_id, email_id, etc.)
      preferences: {},        // User preferences learned
      // NEW: Store action params for "previous/same" reference resolution
      lastActionParams: {},   // { actionName: { params, result, timestamp } }
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Store action params after successful execution
   * This enables "same email", "previous subject", etc. to work
   */
  async storeActionParams(entityId, action, params, result = null, conversationId = 'default') {
    const context = await this.getContext(entityId, conversationId);

    if (!context.lastActionParams) {
      context.lastActionParams = {};
    }

    // Store the action params
    context.lastActionParams[action] = {
      params: this._sanitizeParamsForStorage(params),
      result: result ? this._extractRelevantResult(action, result) : null,
      timestamp: Date.now(),
    };

    // Also store by service type for cross-action lookups
    const service = this._getServiceFromAction(action);
    context.lastActionParams[`_last_${service}`] = {
      action,
      params: this._sanitizeParamsForStorage(params),
      result: result ? this._extractRelevantResult(action, result) : null,
      timestamp: Date.now(),
    };

    await this.saveContext(entityId, context, conversationId);
    console.log(`[ContextMemoryCache] Stored params for ${action}:`, Object.keys(params));

    return context;
  }

  /**
   * Get stored params for an action (for "previous/same" resolution)
   */
  async getStoredActionParams(entityId, action, conversationId = 'default') {
    const context = await this.getContext(entityId, conversationId);

    if (!context.lastActionParams) {
      return null;
    }

    // Direct action match
    if (context.lastActionParams[action]) {
      return context.lastActionParams[action];
    }

    // Try service-level lookup
    const service = this._getServiceFromAction(action);
    const serviceKey = `_last_${service}`;
    if (context.lastActionParams[serviceKey]) {
      return context.lastActionParams[serviceKey];
    }

    return null;
  }

  /**
   * Get all stored action params (for bulk reference resolution)
   */
  async getAllStoredActionParams(entityId, conversationId = 'default') {
    const context = await this.getContext(entityId, conversationId);
    return context.lastActionParams || {};
  }

  /**
   * Get service name from action
   */
  _getServiceFromAction(action) {
    if (!action) return 'unknown';
    if (action.includes('GMAIL')) return 'email';
    if (action.includes('SLACK')) return 'slack';
    if (action.includes('JIRA')) return 'jira';
    if (action.includes('CALENDAR')) return 'calendar';
    if (action.includes('FRAPPE')) return 'frappe';
    if (action.includes('TRELLO')) return 'trello';
    if (action.includes('GITHUB')) return 'github';
    if (action.includes('NOTION')) return 'notion';
    return 'unknown';
  }

  /**
   * Sanitize params for storage (remove large/sensitive data)
   */
  _sanitizeParamsForStorage(params) {
    if (!params) return {};

    const sanitized = {};
    const skipFields = ['body', 'content', 'description', 'html_body', 'attachment', 'attachments'];
    const truncateFields = ['message', 'summary', 'subject'];

    for (const [key, value] of Object.entries(params)) {
      // Skip large/sensitive fields
      if (skipFields.includes(key.toLowerCase())) {
        sanitized[`_has_${key}`] = true; // Mark that it existed
        continue;
      }

      // Truncate long text fields
      if (truncateFields.includes(key.toLowerCase()) && typeof value === 'string' && value.length > 200) {
        sanitized[key] = value.substring(0, 200) + '...';
        continue;
      }

      // Skip internal fields
      if (key.startsWith('_')) continue;

      sanitized[key] = value;
    }

    return sanitized;
  }

  /**
   * Extract relevant result data for storage
   */
  _extractRelevantResult(action, result) {
    if (!result) return null;

    const data = result.data || result;
    const extracted = {};

    // Extract IDs and key info based on action type
    if (action.includes('GMAIL')) {
      if (data.id) extracted.message_id = data.id;
      if (data.threadId) extracted.thread_id = data.threadId;
    } else if (action.includes('CALENDAR')) {
      if (data.id) extracted.event_id = data.id;
      if (data.htmlLink) extracted.event_link = data.htmlLink;
    } else if (action.includes('JIRA')) {
      if (data.key) extracted.issue_key = data.key;
      if (data.id) extracted.issue_id = data.id;
      if (data.browser_url) extracted.issue_url = data.browser_url;
    } else if (action.includes('SLACK')) {
      if (data.ts) extracted.message_ts = data.ts;
      if (data.channel) extracted.channel_id = data.channel;
    } else if (action.includes('FRAPPE')) {
      if (data.name) extracted.doc_name = data.name;
      if (data.doctype) extracted.doctype = data.doctype;
    }

    return Object.keys(extracted).length > 0 ? extracted : null;
  }

  /**
   * Extract entities from text
   */
  extractEntities(text) {
    const entities = {};

    for (const [type, pattern] of Object.entries(ENTITY_PATTERNS)) {
      const matches = text.match(pattern);
      if (matches) {
        entities[type] = [...new Set(matches)]; // Deduplicate
      }
    }

    // Parse relative dates to absolute
    if (entities.date) {
      entities.parsedDates = entities.date.map(d => {
        const lower = d.toLowerCase();
        for (const [expr, fn] of Object.entries(TIME_MAPPINGS)) {
          if (lower.includes(expr)) {
            return { original: d, parsed: fn().toISOString() };
          }
        }
        return { original: d, parsed: null };
      });
    }

    return entities;
  }

  /**
   * Add a message to context and extract entities
   */
  async addMessage(entityId, message, role = 'user', conversationId = 'default') {
    const context = await this.getContext(entityId, conversationId);

    // Extract entities from the message
    const newEntities = this.extractEntities(message);

    // Add message to history (keep last 20)
    context.messages.push({
      role,
      content: message,
      timestamp: Date.now(),
      entities: newEntities,
    });
    if (context.messages.length > 20) {
      context.messages = context.messages.slice(-20);
    }

    // Merge entities (newer overwrites older for same type)
    for (const [type, values] of Object.entries(newEntities)) {
      if (!context.entities[type]) {
        context.entities[type] = [];
      }
      // Add new values, keeping unique
      context.entities[type] = [...new Set([...context.entities[type], ...values])].slice(-10);
    }

    await this.saveContext(entityId, context, conversationId);
    return context;
  }

  /**
   * Store action result with object ID
   */
  async storeActionResult(entityId, result, conversationId = 'default') {
    const context = await this.getContext(entityId, conversationId);

    // Add to action results (keep last 20)
    context.actionResults.push({
      ...result,
      timestamp: Date.now(),
    });
    if (context.actionResults.length > 20) {
      context.actionResults = context.actionResults.slice(-20);
    }

    // Store object IDs by type
    if (result.objectId) {
      const key = result.objectType || result.action;
      if (!context.objectIds[key]) {
        context.objectIds[key] = [];
      }
      context.objectIds[key].push({
        id: result.objectId,
        summary: result.summary,
        timestamp: Date.now(),
      });
      // Keep last 10 per type
      context.objectIds[key] = context.objectIds[key].slice(-10);
    }

    await this.saveContext(entityId, context, conversationId);
    return context;
  }

  /**
   * Try to fill slots from cached context
   * Returns: { filled: object, missing: array }
   */
  async fillSlotsFromContext(entityId, schema, providedParams = {}, conversationId = 'default') {
    const context = await this.getContext(entityId, conversationId);
    const filled = { ...providedParams };
    const missing = [];

    if (!schema || !schema.properties) {
      return { filled, missing: [] };
    }

    const required = schema.required || [];

    for (const [field, fieldSchema] of Object.entries(schema.properties)) {
      // Skip if already provided
      if (filled[field] !== undefined && filled[field] !== null && filled[field] !== '') {
        continue;
      }

      // Try to fill from context
      const value = this._findValueInContext(field, fieldSchema, context);
      if (value !== null) {
        filled[field] = value;
        console.log(`[ContextCache] Auto-filled "${field}" from context: ${JSON.stringify(value).slice(0, 50)}`);
      } else if (required.includes(field)) {
        missing.push({
          field,
          schema: fieldSchema,
          type: fieldSchema.type,
          description: fieldSchema.description,
        });
      }
    }

    return { filled, missing };
  }

  /**
   * Find a value in context that matches a field
   */
  _findValueInContext(field, fieldSchema, context) {
    const fieldLower = field.toLowerCase();

    // Email fields
    if (fieldLower.includes('email') || fieldLower === 'to' || fieldLower === 'recipient') {
      if (context.entities.email && context.entities.email.length > 0) {
        return fieldSchema.type === 'array' ? context.entities.email : context.entities.email[0];
      }
    }

    // Date/time fields
    if (fieldLower.includes('date') || fieldLower.includes('time') || fieldLower === 'start' || fieldLower === 'end') {
      if (context.entities.parsedDates && context.entities.parsedDates.length > 0) {
        const parsed = context.entities.parsedDates.find(d => d.parsed);
        if (parsed) {
          return parsed.parsed;
        }
      }
    }

    // Time min/max for calendar queries
    if (fieldLower === 'timemin' || fieldLower === 'time_min') {
      // Default to start of today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return today.toISOString();
    }
    if (fieldLower === 'timemax' || fieldLower === 'time_max') {
      // Default to end of today
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return today.toISOString();
    }

    // Channel fields
    if (fieldLower.includes('channel')) {
      if (context.entities.slackChannel && context.entities.slackChannel.length > 0) {
        return context.entities.slackChannel[0];
      }
    }

    // Jira issue key
    if (fieldLower.includes('issue') || fieldLower.includes('key') || fieldLower === 'jql') {
      if (context.entities.jiraKey && context.entities.jiraKey.length > 0) {
        if (fieldLower === 'jql') {
          return `key = ${context.entities.jiraKey[0]}`;
        }
        return context.entities.jiraKey[0];
      }
    }

    // Priority
    if (fieldLower.includes('priority')) {
      if (context.entities.priority && context.entities.priority.length > 0) {
        return context.entities.priority[0];
      }
    }

    // Look for referenced object IDs (e.g., "update that event")
    if (fieldLower.includes('event_id') || fieldLower.includes('eventid')) {
      const calendarIds = context.objectIds['GOOGLECALENDAR_CREATE_EVENT'] ||
                          context.objectIds['GOOGLECALENDAR_FIND_EVENT'];
      if (calendarIds && calendarIds.length > 0) {
        return calendarIds[calendarIds.length - 1].id; // Most recent
      }
    }

    if (fieldLower.includes('message_id') || fieldLower.includes('email_id')) {
      const emailIds = context.objectIds['GMAIL_SEND_EMAIL'] ||
                       context.objectIds['GMAIL_LIST_EMAILS'];
      if (emailIds && emailIds.length > 0) {
        return emailIds[emailIds.length - 1].id;
      }
    }

    // Check recent messages for inline values
    const recentText = context.messages.slice(-5).map(m => m.content).join(' ');

    // Look for quoted strings that might be values
    if (fieldLower === 'subject' || fieldLower === 'summary' || fieldLower === 'title') {
      const quoted = recentText.match(/"([^"]+)"|'([^']+)'/);
      if (quoted) {
        return quoted[1] || quoted[2];
      }
    }

    // Look for "about X" or "regarding X"
    if (fieldLower === 'subject' || fieldLower === 'summary' || fieldLower === 'description') {
      const aboutMatch = recentText.match(/(?:about|regarding|re:|for)\s+["']?([^"'\n.!?]+)/i);
      if (aboutMatch) {
        return aboutMatch[1].trim();
      }
    }

    return null;
  }

  /**
   * Get the most recent object ID of a type
   */
  async getLastObjectId(entityId, objectType, conversationId = 'default') {
    const context = await this.getContext(entityId, conversationId);
    const ids = context.objectIds[objectType];
    if (ids && ids.length > 0) {
      return ids[ids.length - 1];
    }
    return null;
  }

  /**
   * Get timezone for entity (from preferences or default)
   */
  async getTimezone(entityId, conversationId = 'default') {
    const context = await this.getContext(entityId, conversationId);
    return context.preferences.timezone || 'America/Los_Angeles';
  }

  /**
   * Set user preference
   */
  async setPreference(entityId, key, value, conversationId = 'default') {
    const context = await this.getContext(entityId, conversationId);
    context.preferences[key] = value;
    await this.saveContext(entityId, context, conversationId);
  }

  /**
   * Clear context for a user
   */
  async clearContext(entityId, conversationId = 'default') {
    const key = this._getKey(entityId, conversationId);

    if (redis.isAvailable()) {
      await redis.del(key);
    } else {
      this.memoryCache.delete(key);
    }
  }

  /**
   * Get summary of cached context (for debugging/display)
   */
  async getContextSummary(entityId, conversationId = 'default') {
    const context = await this.getContext(entityId, conversationId);

    return {
      messageCount: context.messages.length,
      entities: Object.keys(context.entities).reduce((acc, key) => {
        acc[key] = context.entities[key].length;
        return acc;
      }, {}),
      actionCount: context.actionResults.length,
      storedObjects: Object.keys(context.objectIds).reduce((acc, key) => {
        acc[key] = context.objectIds[key].length;
        return acc;
      }, {}),
      preferences: context.preferences,
    };
  }
}

module.exports = { ContextMemoryCache };
