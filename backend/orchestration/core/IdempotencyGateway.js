/**
 * IdempotencyGateway - Multi-Layer Idempotency System
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                    IDEMPOTENCY GATEWAY                                  │
 * │                                                                         │
 * │  Request ──→ ┌──────────────────┐                                      │
 * │              │ Request ID Check │──→ Invalid? → REJECT                 │
 * │              └────────┬─────────┘                                      │
 * │                       ↓                                                 │
 * │              ┌──────────────────┐                                      │
 * │              │ Semantic Key Gen │──→ Hash(action + significant params) │
 * │              └────────┬─────────┘                                      │
 * │                       ↓                                                 │
 * │              ┌──────────────────┐                                      │
 * │              │ State Lookup     │──→ Already executed? → RETURN CACHED │
 * │              └────────┬─────────┘                                      │
 * │                       ↓                                                 │
 * │              ┌──────────────────┐                                      │
 * │              │ Provider Check   │──→ Duplicate in provider? → DEDUPE   │
 * │              └────────┬─────────┘                                      │
 * │                       ↓                                                 │
 * │              ┌──────────────────┐                                      │
 * │              │ Execute + Track  │──→ Update state machine              │
 * │              └──────────────────┘                                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Execution States:
 * - PENDING: Request received, not yet started
 * - IN_PROGRESS: Currently executing
 * - COMPLETED: Successfully finished
 * - FAILED: Execution failed (may retry)
 * - RETRYING: Retry in progress
 *
 * Semantic Key Structure:
 * - Action-specific significant parameters only
 * - Ignores noise fields (request IDs, timestamps)
 * - Time-bucketed for calendar events (15-min windows)
 */

const crypto = require('crypto');
const { ACTION_ALLOWLIST } = require('./ActionRegistry');

// Execution state machine states
const EXECUTION_STATES = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RETRYING: 'retrying',
};

// State transition rules
const VALID_TRANSITIONS = {
  [EXECUTION_STATES.PENDING]: [EXECUTION_STATES.IN_PROGRESS, EXECUTION_STATES.FAILED],
  [EXECUTION_STATES.IN_PROGRESS]: [EXECUTION_STATES.COMPLETED, EXECUTION_STATES.FAILED],
  [EXECUTION_STATES.COMPLETED]: [], // Terminal state
  [EXECUTION_STATES.FAILED]: [EXECUTION_STATES.RETRYING],
  [EXECUTION_STATES.RETRYING]: [EXECUTION_STATES.IN_PROGRESS, EXECUTION_STATES.FAILED],
};

// Semantic key schemas - which fields matter for deduplication per action
const SEMANTIC_KEY_SCHEMAS = {
  // Calendar actions
  GOOGLECALENDAR_CREATE_EVENT: {
    fields: ['title', 'start_datetime', 'end_datetime', 'attendees'],
    timeBucket: 15, // 15-minute buckets for start time
    normalize: {
      title: (v) => v?.toLowerCase().trim(),
      attendees: (v) => Array.isArray(v) ? v.map(a => a.toLowerCase()).sort() : [],
    },
  },
  GOOGLECALENDAR_UPDATE_EVENT: {
    fields: ['event_id', 'title', 'start_datetime', 'end_datetime'],
    timeBucket: 15,
  },
  GOOGLECALENDAR_DELETE_EVENT: {
    fields: ['event_id'],
  },
  GOOGLECALENDAR_FIND_EVENT: {
    fields: ['query', 'timeMin', 'timeMax'],
    timeBucket: 60, // Hour buckets for search window
  },
  GOOGLECALENDAR_LIST_CALENDARS: {
    fields: [], // No significant params
  },

  // Gmail actions
  GMAIL_SEND_EMAIL: {
    fields: ['to', 'subject', 'body'],
    normalize: {
      to: (v) => Array.isArray(v) ? v.map(e => e.toLowerCase()).sort() : [v?.toLowerCase()],
      subject: (v) => v?.toLowerCase().trim(),
      body: (v) => v?.substring(0, 200)?.trim(), // First 200 chars for comparison
    },
  },
  GMAIL_REPLY_TO_THREAD: {
    fields: ['thread_id', 'body'],
    normalize: {
      body: (v) => v?.substring(0, 200)?.trim(),
    },
  },
  GMAIL_CREATE_DRAFT: {
    fields: ['to', 'subject', 'body'],
    normalize: {
      to: (v) => Array.isArray(v) ? v.map(e => e.toLowerCase()).sort() : [v?.toLowerCase()],
    },
  },
  GMAIL_FETCH_EMAILS: {
    fields: ['query', 'maxResults'],
  },

  // Slack actions
  SLACK_SEND_MESSAGE: {
    fields: ['channel', 'text'],
    normalize: {
      channel: (v) => v?.toLowerCase(),
      text: (v) => v?.substring(0, 200)?.trim(),
    },
  },

  // Jira actions
  JIRA_CREATE_ISSUE: {
    fields: ['project', 'summary', 'issuetype'],
    normalize: {
      summary: (v) => v?.toLowerCase().trim(),
    },
  },
  JIRA_UPDATE_ISSUE: {
    fields: ['issue_id', 'summary', 'status'],
  },

  // Default schema for unknown actions
  _default: {
    fields: [], // Include all params
    normalize: {},
  },
};

// Provider duplicate detection configurations
const PROVIDER_DEDUP_CONFIG = {
  GOOGLECALENDAR_CREATE_EVENT: {
    provider: 'google_calendar',
    lookupMethod: 'search_by_time_window',
    matchFields: ['title', 'start_datetime'],
    timeWindow: 30, // minutes
    enabled: true,
  },
  GMAIL_SEND_EMAIL: {
    provider: 'gmail',
    lookupMethod: 'search_sent_recent',
    matchFields: ['to', 'subject'],
    timeWindow: 5, // minutes
    enabled: true,
  },
  SLACK_SEND_MESSAGE: {
    provider: 'slack',
    lookupMethod: 'search_channel_recent',
    matchFields: ['channel', 'text'],
    timeWindow: 2, // minutes
    enabled: true,
  },
  JIRA_CREATE_ISSUE: {
    provider: 'jira',
    lookupMethod: 'search_project_recent',
    matchFields: ['project', 'summary'],
    timeWindow: 10, // minutes
    enabled: true,
  },
};

class IdempotencyGateway {
  constructor(options = {}) {
    // In-memory state store (replace with database in production)
    this.stateStore = new Map();
    this.requestIdStore = new Map();

    // Configuration
    this.ttlMs = options.ttlMs || 24 * 60 * 60 * 1000; // 24 hours default
    this.maxRetries = options.maxRetries || 3;
    this.cleanupIntervalMs = options.cleanupIntervalMs || 60 * 60 * 1000; // 1 hour

    // Callbacks
    this.onDuplicate = options.onDuplicate || null;
    this.onStateChange = options.onStateChange || null;
    this.providerLookup = options.providerLookup || null; // Function to check provider for duplicates

    // Start cleanup interval
    this._startCleanup();
  }

  /**
   * Check if a request can proceed (main entry point)
   * @param {string} requestId - Client-generated request ID
   * @param {string} actionName - The action being executed
   * @param {Object} params - Action parameters
   * @param {Object} context - Execution context (user, session, etc.)
   * @returns {Object} { canProceed, reason, cachedResult, semanticKey, state }
   */
  async check(requestId, actionName, params, context = {}) {
    console.log(`[IdempotencyGateway] Checking: ${actionName} with requestId: ${requestId}`);

    // Step 1: Validate request ID format
    const requestIdCheck = this._validateRequestId(requestId, context);
    if (!requestIdCheck.valid) {
      return {
        canProceed: false,
        reason: requestIdCheck.reason,
        cachedResult: null,
        semanticKey: null,
        state: null,
        blocked_by: 'request_id_validation',
      };
    }

    // Step 2: Check if we've seen this exact request ID before
    const existingByRequestId = this._getByRequestId(requestId);
    if (existingByRequestId) {
      console.log(`[IdempotencyGateway] Found existing request by ID: ${requestId}, state: ${existingByRequestId.state}`);

      if (existingByRequestId.state === EXECUTION_STATES.COMPLETED) {
        return {
          canProceed: false,
          reason: 'Request already completed',
          cachedResult: existingByRequestId.result,
          semanticKey: existingByRequestId.semanticKey,
          state: existingByRequestId.state,
          blocked_by: 'request_id_duplicate',
        };
      }

      if (existingByRequestId.state === EXECUTION_STATES.IN_PROGRESS) {
        return {
          canProceed: false,
          reason: 'Request already in progress',
          cachedResult: null,
          semanticKey: existingByRequestId.semanticKey,
          state: existingByRequestId.state,
          blocked_by: 'request_in_progress',
        };
      }
    }

    // Step 3: Generate semantic key
    const semanticKey = this._generateSemanticKey(actionName, params);
    console.log(`[IdempotencyGateway] Semantic key: ${semanticKey}`);

    // Step 4: Check if we've executed this semantic action recently
    const existingBySemantic = this._getBySemanticKey(semanticKey);
    if (existingBySemantic) {
      const age = Date.now() - existingBySemantic.timestamp;
      const actionConfig = PROVIDER_DEDUP_CONFIG[actionName];
      const dedupWindow = (actionConfig?.timeWindow || 30) * 60 * 1000;

      if (existingBySemantic.state === EXECUTION_STATES.COMPLETED && age < dedupWindow) {
        console.log(`[IdempotencyGateway] Semantic duplicate detected, age: ${age}ms, window: ${dedupWindow}ms`);

        if (this.onDuplicate) {
          this.onDuplicate({
            type: 'semantic',
            action: actionName,
            semanticKey,
            originalRequestId: existingBySemantic.requestId,
            newRequestId: requestId,
          });
        }

        return {
          canProceed: false,
          reason: `Similar ${actionName} action already completed ${Math.round(age / 1000)}s ago`,
          cachedResult: existingBySemantic.result,
          semanticKey,
          state: existingBySemantic.state,
          blocked_by: 'semantic_duplicate',
          originalRequestId: existingBySemantic.requestId,
        };
      }
    }

    // Step 5: Check provider for potential duplicates (async)
    const providerCheck = await this._checkProviderDuplicate(actionName, params, context);
    if (providerCheck.isDuplicate) {
      console.log(`[IdempotencyGateway] Provider duplicate detected: ${providerCheck.reason}`);

      return {
        canProceed: false,
        reason: providerCheck.reason,
        cachedResult: providerCheck.existingResource,
        semanticKey,
        state: EXECUTION_STATES.COMPLETED,
        blocked_by: 'provider_duplicate',
        existingResourceId: providerCheck.resourceId,
      };
    }

    // Step 6: All checks passed - register this execution
    this._registerExecution(requestId, actionName, params, semanticKey, context);

    return {
      canProceed: true,
      reason: null,
      cachedResult: null,
      semanticKey,
      state: EXECUTION_STATES.PENDING,
      blocked_by: null,
    };
  }

  /**
   * Mark execution as started
   */
  markInProgress(requestId) {
    return this._transitionState(requestId, EXECUTION_STATES.IN_PROGRESS);
  }

  /**
   * Mark execution as completed with result
   */
  markCompleted(requestId, result) {
    const entry = this.requestIdStore.get(requestId);
    if (entry) {
      entry.result = result;
      entry.completedAt = new Date().toISOString();
    }
    return this._transitionState(requestId, EXECUTION_STATES.COMPLETED);
  }

  /**
   * Mark execution as failed
   */
  markFailed(requestId, error) {
    const entry = this.requestIdStore.get(requestId);
    if (entry) {
      entry.error = error;
      entry.failedAt = new Date().toISOString();
      entry.retryCount = (entry.retryCount || 0);
    }
    return this._transitionState(requestId, EXECUTION_STATES.FAILED);
  }

  /**
   * Attempt retry (if allowed)
   */
  attemptRetry(requestId) {
    const entry = this.requestIdStore.get(requestId);
    if (!entry) {
      return { allowed: false, reason: 'Request not found' };
    }

    if (entry.state !== EXECUTION_STATES.FAILED) {
      return { allowed: false, reason: `Cannot retry from state: ${entry.state}` };
    }

    if ((entry.retryCount || 0) >= this.maxRetries) {
      return { allowed: false, reason: `Max retries (${this.maxRetries}) exceeded` };
    }

    entry.retryCount = (entry.retryCount || 0) + 1;
    this._transitionState(requestId, EXECUTION_STATES.RETRYING);

    return { allowed: true, retryCount: entry.retryCount };
  }

  /**
   * Get execution state for a request
   */
  getState(requestId) {
    const entry = this.requestIdStore.get(requestId);
    if (!entry) return null;

    return {
      requestId,
      actionName: entry.actionName,
      state: entry.state,
      semanticKey: entry.semanticKey,
      timestamp: entry.timestamp,
      completedAt: entry.completedAt,
      failedAt: entry.failedAt,
      error: entry.error,
      retryCount: entry.retryCount,
      result: entry.result,
    };
  }

  /**
   * Validate request ID format and uniqueness
   */
  _validateRequestId(requestId, context) {
    if (!requestId) {
      return { valid: false, reason: 'Request ID is required' };
    }

    if (typeof requestId !== 'string') {
      return { valid: false, reason: 'Request ID must be a string' };
    }

    // Expected format: uuid v4 or custom format with timestamp
    // Examples: "550e8400-e29b-41d4-a716-446655440000" or "req_1702555200000_abc123"
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const customPattern = /^req_\d+_[a-zA-Z0-9]+$/;

    if (!uuidPattern.test(requestId) && !customPattern.test(requestId)) {
      // Be lenient - accept any reasonable string
      if (requestId.length < 8 || requestId.length > 128) {
        return { valid: false, reason: 'Request ID must be 8-128 characters' };
      }
    }

    return { valid: true };
  }

  /**
   * Generate semantic key for deduplication
   */
  _generateSemanticKey(actionName, params) {
    const schemaForAction = SEMANTIC_KEY_SCHEMAS[actionName] || null;
    const schema = schemaForAction || SEMANTIC_KEY_SCHEMAS._default;

    const keyData = { action: actionName };

    // IMPORTANT:
    // - For *known* actions with an explicit schema.fields = [], we dedupe by action only (typical reads).
    // - For *unknown/dynamic* actions, we must include params; otherwise distinct calls collapse into one.
    if (schemaForAction && schema.fields.length === 0) {
      return this._hashKey(keyData);
    }

    // Unknown action: include a stable, bounded snapshot of params.
    if (!schemaForAction) {
      keyData.params = this._stableStringify(params);
      return this._hashKey(keyData);
    }

    // Known action: extract configured significant fields.
    for (const field of schema.fields) {
      let value = params[field];

      // Apply normalization if defined
      if (schema.normalize && schema.normalize[field]) {
        value = schema.normalize[field](value);
      }

      // Apply time bucketing if applicable
      if (schema.timeBucket && (field.includes('datetime') || field.includes('time'))) {
        value = this._bucketTime(value, schema.timeBucket);
      }

      if (value !== undefined && value !== null) {
        keyData[field] = value;
      }
    }

    return this._hashKey(keyData);
  }

  /**
   * Stable stringify for semantic key snapshots (bounded).
   * Keeps nested object keys sorted and caps large strings/arrays to reduce volatility.
   */
  _stableStringify(value, depth = 0) {
    const MAX_DEPTH = 6;
    const MAX_KEYS = 60;
    const MAX_ARRAY = 40;
    const MAX_STRING = 500;

    if (value === null || value === undefined) return null;
    if (depth >= MAX_DEPTH) return '[MaxDepth]';

    const t = typeof value;
    if (t === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
    if (t === 'number' || t === 'boolean') return value;

    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY).map(v => this._stableStringify(v, depth + 1));
    }

    if (t === 'object') {
      const out = {};
      const keys = Object.keys(value).sort().slice(0, MAX_KEYS);
      for (const k of keys) {
        out[k] = this._stableStringify(value[k], depth + 1);
      }
      return out;
    }

    // bigint / symbol / function etc.
    try {
      return String(value);
    } catch {
      return '[Unstringifiable]';
    }
  }

  /**
   * Hash key data to create semantic key
   */
  _hashKey(data) {
    // IMPORTANT: do not use JSON.stringify replacer arrays here.
    // A replacer array acts as a whitelist for *all nested objects*, which
    // would accidentally drop nested param keys and collapse distinct requests.
    const normalized = JSON.stringify(this._stableStringify(data));
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 32);
  }

  /**
   * Bucket time to reduce sensitivity
   */
  _bucketTime(isoTime, bucketMinutes) {
    if (!isoTime) return null;

    try {
      const date = new Date(isoTime);
      if (isNaN(date.getTime())) return isoTime;

      const minutes = date.getMinutes();
      const bucketedMinutes = Math.floor(minutes / bucketMinutes) * bucketMinutes;
      date.setMinutes(bucketedMinutes, 0, 0);

      return date.toISOString();
    } catch (e) {
      return isoTime;
    }
  }

  /**
   * Check provider for existing duplicate
   */
  async _checkProviderDuplicate(actionName, params, context) {
    const config = PROVIDER_DEDUP_CONFIG[actionName];

    if (!config || !config.enabled) {
      return { isDuplicate: false };
    }

    // If no provider lookup function configured, skip
    if (!this.providerLookup) {
      return { isDuplicate: false };
    }

    try {
      const result = await this.providerLookup({
        provider: config.provider,
        method: config.lookupMethod,
        matchFields: config.matchFields,
        timeWindow: config.timeWindow,
        actionName,
        params,
        context,
      });

      if (result && result.found) {
        return {
          isDuplicate: true,
          reason: `${config.provider} already has this: ${result.description || 'existing resource'}`,
          existingResource: result.resource,
          resourceId: result.resourceId,
        };
      }

      return { isDuplicate: false };
    } catch (error) {
      console.error(`[IdempotencyGateway] Provider lookup failed: ${error.message}`);
      // Don't block on provider check failure
      return { isDuplicate: false };
    }
  }

  /**
   * Get entry by request ID
   */
  _getByRequestId(requestId) {
    return this.requestIdStore.get(requestId);
  }

  /**
   * Get entry by semantic key
   */
  _getBySemanticKey(semanticKey) {
    return this.stateStore.get(semanticKey);
  }

  /**
   * Register new execution
   */
  _registerExecution(requestId, actionName, params, semanticKey, context) {
    const entry = {
      requestId,
      actionName,
      params: this._sanitizeParamsForStorage(params),
      semanticKey,
      state: EXECUTION_STATES.PENDING,
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
      context: {
        userId: context.userId,
        sessionId: context.sessionId,
      },
      retryCount: 0,
    };

    this.requestIdStore.set(requestId, entry);
    this.stateStore.set(semanticKey, entry);

    console.log(`[IdempotencyGateway] Registered execution: ${requestId} -> ${semanticKey}`);
  }

  /**
   * Transition state with validation
   */
  _transitionState(requestId, newState) {
    const entry = this.requestIdStore.get(requestId);
    if (!entry) {
      return { success: false, reason: 'Request not found' };
    }

    const currentState = entry.state;
    const validTransitions = VALID_TRANSITIONS[currentState] || [];

    if (!validTransitions.includes(newState)) {
      return {
        success: false,
        reason: `Invalid transition: ${currentState} -> ${newState}`,
      };
    }

    const oldState = entry.state;
    entry.state = newState;
    entry.lastUpdated = new Date().toISOString();

    // Update semantic store too
    if (entry.semanticKey) {
      this.stateStore.set(entry.semanticKey, entry);
    }

    console.log(`[IdempotencyGateway] State transition: ${requestId} ${oldState} -> ${newState}`);

    if (this.onStateChange) {
      this.onStateChange({
        requestId,
        actionName: entry.actionName,
        oldState,
        newState,
        timestamp: entry.lastUpdated,
      });
    }

    return { success: true, state: newState };
  }

  /**
   * Sanitize params for storage (remove sensitive data)
   */
  _sanitizeParamsForStorage(params) {
    if (!params) return params;

    const sanitized = { ...params };
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'credential', 'body'];

    for (const key of Object.keys(sanitized)) {
      const keyLower = key.toLowerCase();
      for (const sensitive of sensitiveFields) {
        if (keyLower.includes(sensitive)) {
          sanitized[key] = '[REDACTED]';
          break;
        }
      }
    }

    return sanitized;
  }

  /**
   * Cleanup expired entries
   */
  _cleanup() {
    const now = Date.now();
    const expiredRequestIds = [];
    const expiredSemanticKeys = [];

    for (const [requestId, entry] of this.requestIdStore.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        expiredRequestIds.push(requestId);
      }
    }

    for (const [semanticKey, entry] of this.stateStore.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        expiredSemanticKeys.push(semanticKey);
      }
    }

    for (const requestId of expiredRequestIds) {
      this.requestIdStore.delete(requestId);
    }

    for (const semanticKey of expiredSemanticKeys) {
      this.stateStore.delete(semanticKey);
    }

    if (expiredRequestIds.length > 0 || expiredSemanticKeys.length > 0) {
      console.log(`[IdempotencyGateway] Cleanup: removed ${expiredRequestIds.length} requests, ${expiredSemanticKeys.length} semantic keys`);
    }
  }

  /**
   * Start cleanup interval
   */
  _startCleanup() {
    this._cleanupInterval = setInterval(() => {
      this._cleanup();
    }, this.cleanupIntervalMs);

    // Don't prevent process exit
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  /**
   * Stop cleanup interval (for testing/shutdown)
   */
  stopCleanup() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const states = {};
    for (const state of Object.values(EXECUTION_STATES)) {
      states[state] = 0;
    }

    for (const entry of this.requestIdStore.values()) {
      states[entry.state] = (states[entry.state] || 0) + 1;
    }

    return {
      totalRequests: this.requestIdStore.size,
      totalSemanticKeys: this.stateStore.size,
      byState: states,
    };
  }

  /**
   * Clear all state (for testing)
   */
  clear() {
    this.stateStore.clear();
    this.requestIdStore.clear();
  }
}

// Singleton instance
let _defaultGateway = null;
function getIdempotencyGateway(options = {}) {
  if (!_defaultGateway) {
    _defaultGateway = new IdempotencyGateway(options);
  }
  return _defaultGateway;
}

module.exports = {
  IdempotencyGateway,
  EXECUTION_STATES,
  VALID_TRANSITIONS,
  SEMANTIC_KEY_SCHEMAS,
  PROVIDER_DEDUP_CONFIG,
  getIdempotencyGateway,
};
