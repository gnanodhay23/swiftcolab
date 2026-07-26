/**
 * Enhanced Automation Engine - Complete 8 Automation Workflow Implementation
 *
 * Workflows:
 * 1. Rule Builder - Convert natural language to structured rules
 * 2. Clarifier - Ask targeted questions for ambiguous rules
 * 3. Scheduler - Handle cron-based and time-delayed rules
 * 4. Event Ingestion - Process webhooks and app events
 * 5. Rule Evaluator - Match events against rules
 * 6. Executor - Execute rule actions reliably
 * 7. Dedupe & Audit - Prevent duplicates, track history
 * 8. Monitoring & Self-Heal - Health checks and auto-recovery
 */

const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');

class AutomationEngine {
  constructor({ composio, query, executor }) {
    this.composio = composio;
    this.query = query;
    this.executor = executor;

    // Active scheduled jobs
    this.scheduledJobs = new Map();

    // Event handlers
    this.eventHandlers = new Map();

    // Deduplication cache (in-memory + DB backed)
    this.dedupeCache = new Map();

    // Health monitoring state
    this.healthState = {
      lastCheck: null,
      failedRules: new Set(),
      consecutiveFailures: new Map(),
      isHealthy: true,
    };

    // Rule templates for common automations
    this.ruleTemplates = {
      JIRA_TO_SLACK: {
        trigger: { type: 'event', app: 'JIRA', event: 'issue_transitioned' },
        action: { tool: 'SLACK_SEND_MESSAGE' },
      },
      GITHUB_PR_NOTIFICATION: {
        trigger: { type: 'event', app: 'GITHUB', event: 'pull_request' },
        action: { tool: 'SLACK_SEND_MESSAGE' },
      },
      DAILY_STANDUP: {
        trigger: { type: 'schedule', cron: '0 9 * * 1-5' },
        action: { tool: 'SLACK_SEND_MESSAGE' },
      },
      EMAIL_TO_JIRA: {
        trigger: { type: 'event', app: 'GMAIL', event: 'new_email' },
        action: { tool: 'JIRA_CREATE_ISSUE' },
      },
    };
  }

  // ============================================
  // WORKFLOW 1: RULE BUILDER
  // Convert natural language to structured rules
  // ============================================

  async createRule(userId, description, callGemini) {
    console.log('[AutomationEngine] Creating rule from:', description);

    // Parse natural language to rule config
    const systemPrompt = `You are an automation rule parser. Convert the user's natural language automation request into a structured rule.

Available triggers:
- event: Triggered by app events (JIRA issue changes, GitHub PRs, Slack messages, emails)
- schedule: Triggered by cron schedule (daily at 9am, every Monday, etc.)
- webhook: Triggered by external webhook calls

Available apps and events:
- JIRA: issue_created, issue_updated, issue_transitioned, issue_assigned, issue_commented
- GITHUB: pull_request_opened, pull_request_merged, pull_request_closed, push, issue_opened
- SLACK: message_posted, mention, reaction_added
- GMAIL: new_email, email_labeled
- TRELLO: card_created, card_moved, card_assigned
- GOOGLECALENDAR: event_starting, event_created

Available actions:
- SLACK_SEND_MESSAGE, SLACK_SEND_CHANNEL_MESSAGE
- JIRA_CREATE_ISSUE, JIRA_UPDATE_ISSUE, JIRA_ADD_COMMENT, JIRA_TRANSITION_ISSUE
- GMAIL_SEND_EMAIL, GMAIL_CREATE_DRAFT
- GOOGLECALENDAR_CREATE_EVENT
- TRELLO_CREATE_CARD, TRELLO_MOVE_CARD
- GITHUB_CREATE_ISSUE, GITHUB_CREATE_COMMENT

Examples:
- "Whenever Jira tickets are marked done, send them to Slack #releases" ->
  trigger: {type: "event", app: "JIRA", event: "issue_transitioned", filters: {toStatus: "Done"}}
  action: {tool: "SLACK_SEND_CHANNEL_MESSAGE", params: {channel: "#releases"}, template: "✅ {{issue.key}}: {{issue.summary}} is now Done"}

- "Every morning at 9am, send me a daily digest" ->
  trigger: {type: "schedule", cron: "0 9 * * *", timezone: "America/New_York"}
  action: {tool: "DAILY_DIGEST", template: null}

- "When new emails arrive from boss@company.com, create a Jira task" ->
  trigger: {type: "event", app: "GMAIL", event: "new_email", filters: {from: "boss@company.com"}}
  action: {tool: "JIRA_CREATE_ISSUE", template: {summary: "Email: {{email.subject}}", description: "{{email.body}}"}}

- "When PRs are opened, post to #engineering" ->
  trigger: {type: "event", app: "GITHUB", event: "pull_request_opened"}
  action: {tool: "SLACK_SEND_CHANNEL_MESSAGE", params: {channel: "#engineering"}, template: "New PR: {{pr.title}} by {{pr.author}}"}

Respond with ONLY a JSON object:
{
  "name": "short name for the rule",
  "description": "what this automation does",
  "trigger": {
    "type": "event" | "schedule" | "webhook",
    "app": "APP_NAME" (for event type),
    "event": "event_name" (for event type),
    "cron": "cron expression" (for schedule type),
    "timezone": "timezone" (for schedule type),
    "filters": {} (optional filters)
  },
  "action": {
    "tool": "TOOL_NAME",
    "params": {},
    "template": "message template with {{variables}}" | null
  },
  "conditions": [
    {"field": "path.to.field", "operator": "equals|contains|matches|gt|lt", "value": "..."}
  ],
  "requiredParams": ["param names that need user input"],
  "questions": [{"id": "param_name", "question": "user-friendly question", "hint": "helpful hint"}]
}`;

    try {
      const response = await callGemini(systemPrompt, description, 0);

      let jsonStr = response;
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);

      // Check if we need more info
      if (parsed.requiredParams && parsed.requiredParams.length > 0) {
        return {
          type: 'needs_params',
          name: parsed.name,
          description: parsed.description,
          triggerConfig: parsed.trigger,
          actionConfig: parsed.action,
          conditions: parsed.conditions || [],
          requiredParams: parsed.requiredParams,
          questions: parsed.questions || [],
        };
      }

      // Create the rule
      const rule = await this.saveRule({
        userId,
        name: parsed.name,
        description: parsed.description || description,
        triggerType: parsed.trigger.type,
        triggerConfig: parsed.trigger,
        actionType: 'single_tool',
        actionConfig: parsed.action,
        conditions: parsed.conditions || [],
        status: 'active',
      });

      // If schedule-based, start the scheduler
      if (parsed.trigger.type === 'schedule') {
        this.scheduleRule(rule);
      }

      return {
        type: 'created',
        rule,
        message: `Created automation: "${parsed.name}"`,
      };
    } catch (error) {
      console.error('[AutomationEngine] Error creating rule:', error);
      throw error;
    }
  }

  // ============================================
  // WORKFLOW 2: CLARIFIER
  // Ask targeted questions for ambiguous rules
  // ============================================

  async clarifyRule(userId, ruleContext, answers, callGemini) {
    console.log('[AutomationEngine] Clarifying rule with answers:', answers);

    // Merge answers into the rule config
    const triggerConfig = { ...ruleContext.triggerConfig };
    const actionConfig = { ...ruleContext.actionConfig };

    for (const answer of answers) {
      // Determine where to put the answer
      if (answer.id.startsWith('trigger_')) {
        const key = answer.id.replace('trigger_', '');
        if (!triggerConfig.filters) triggerConfig.filters = {};
        triggerConfig.filters[key] = answer.value;
      } else if (answer.id.startsWith('action_')) {
        const key = answer.id.replace('action_', '');
        if (!actionConfig.params) actionConfig.params = {};
        actionConfig.params[key] = answer.value;
      } else {
        // General param - try action first
        if (!actionConfig.params) actionConfig.params = {};
        actionConfig.params[answer.id] = answer.value;
      }
    }

    // Check if we still need more info
    const stillMissing = ruleContext.requiredParams.filter(
      param => !answers.some(a => a.id === param)
    );

    if (stillMissing.length > 0) {
      return {
        type: 'needs_params',
        name: ruleContext.name,
        triggerConfig,
        actionConfig,
        conditions: ruleContext.conditions || [],
        requiredParams: stillMissing,
        questions: ruleContext.questions.filter(q => stillMissing.includes(q.id)),
      };
    }

    // Create the rule
    const rule = await this.saveRule({
      userId,
      name: ruleContext.name,
      description: ruleContext.description || `Automation: ${ruleContext.name}`,
      triggerType: triggerConfig.type,
      triggerConfig,
      actionType: 'single_tool',
      actionConfig,
      conditions: ruleContext.conditions || [],
      status: 'active',
    });

    // If schedule-based, start the scheduler
    if (triggerConfig.type === 'schedule') {
      this.scheduleRule(rule);
    }

    return {
      type: 'created',
      rule,
      message: `Created automation: "${ruleContext.name}"`,
    };
  }

  // ============================================
  // WORKFLOW 3: SCHEDULER
  // Handle cron-based and time-delayed rules
  // ============================================

  scheduleRule(rule) {
    const { cron: cronExpr, timezone } = rule.triggerConfig || rule.trigger_config || {};

    if (!cronExpr) {
      console.error('[AutomationEngine] No cron expression for scheduled rule');
      return;
    }

    // Stop existing job if any
    if (this.scheduledJobs.has(rule.id)) {
      this.scheduledJobs.get(rule.id).stop();
    }

    console.log(`[AutomationEngine] Scheduling rule ${rule.id} with cron: ${cronExpr}`);

    const job = cron.schedule(cronExpr, async () => {
      console.log(`[AutomationEngine] Executing scheduled rule: ${rule.name}`);
      await this.executeRule(rule, {
        type: 'schedule',
        timestamp: new Date().toISOString(),
        scheduledTime: cronExpr,
      });
    }, {
      timezone: timezone || 'America/New_York',
      scheduled: true,
    });

    this.scheduledJobs.set(rule.id, job);
  }

  async scheduleDelayedExecution(rule, delayMs) {
    console.log(`[AutomationEngine] Scheduling delayed execution in ${delayMs}ms`);

    const executionId = uuidv4();
    const executeAt = new Date(Date.now() + delayMs);

    // Store in DB for durability
    await this.query(
      `INSERT INTO delayed_executions (id, rule_id, user_id, action_type, action_config, scheduled_for, status, created_at)
       VALUES ($1, $2, $3, 'rule_execution', $4, $5, 'pending', NOW())`,
      [executionId, rule.id, rule.user_id, JSON.stringify({ ruleId: rule.id }), executeAt.toISOString()]
    );

    // Also set a timeout for immediate execution (in case server stays running)
    setTimeout(async () => {
      try {
        const stillPending = await this.query(
          'SELECT * FROM delayed_executions WHERE id = $1 AND status = $2',
          [executionId, 'pending']
        );

        if (stillPending.rows.length > 0) {
          await this.executeRule(rule, { type: 'delayed', executionId });
          await this.query(
            'UPDATE delayed_executions SET status = $1, executed_at = NOW() WHERE id = $2',
            ['executed', executionId]
          );
        }
      } catch (error) {
        console.error('[AutomationEngine] Delayed execution error:', error);
      }
    }, delayMs);

    return executionId;
  }

  // ============================================
  // WORKFLOW 4: EVENT INGESTION
  // Process webhooks and app events
  // ============================================

  async processEvent(event) {
    console.log('[AutomationEngine] Processing event:', event.type, event.app);

    // Store the event
    const eventId = uuidv4();
    await this.storeEvent(eventId, event);

    // Normalize the event payload
    const normalizedEvent = this.normalizeEvent(event);

    // Find matching rules
    const matchingRules = await this.findMatchingRules(normalizedEvent);
    console.log(`[AutomationEngine] Found ${matchingRules.length} matching rules`);

    // Execute each matching rule
    const results = [];
    for (const rule of matchingRules) {
      try {
        // Check deduplication
        const isDupe = await this.checkDedupe(rule.id, event);
        if (isDupe) {
          console.log('[AutomationEngine] Skipping duplicate event for rule:', rule.id);
          results.push({ ruleId: rule.id, skipped: true, reason: 'duplicate' });
          continue;
        }

        const result = await this.executeRule(rule, normalizedEvent);
        results.push({ ruleId: rule.id, success: true, result });

        // Mark for dedupe
        await this.markProcessed(rule.id, event);
      } catch (error) {
        console.error(`[AutomationEngine] Error executing rule ${rule.id}:`, error);
        results.push({ ruleId: rule.id, success: false, error: error.message });

        // Track failure for health monitoring
        this.trackFailure(rule.id, error);
      }
    }

    // Update event status
    await this.updateEventStatus(eventId, 'processed', matchingRules.map(r => r.id));

    return results;
  }

  async storeEvent(eventId, event) {
    await this.query(
      `INSERT INTO webhook_events (id, source_app, event_type, raw_payload, normalized_payload, status, received_at)
       VALUES ($1, $2, $3, $4, $5, 'processing', NOW())`,
      [eventId, event.app, event.type, JSON.stringify(event.payload), JSON.stringify(this.normalizeEvent(event))]
    );
  }

  normalizeEvent(event) {
    // Normalize different event formats to a common structure
    const normalized = {
      app: event.app,
      type: event.type,
      timestamp: event.timestamp || new Date().toISOString(),
      raw: event.payload,
    };

    switch (event.app?.toUpperCase()) {
      case 'JIRA':
        normalized.issue = {
          key: event.payload?.issue?.key,
          summary: event.payload?.issue?.fields?.summary,
          status: event.payload?.issue?.fields?.status?.name,
          assignee: event.payload?.issue?.fields?.assignee?.displayName,
          priority: event.payload?.issue?.fields?.priority?.name,
          reporter: event.payload?.issue?.fields?.reporter?.displayName,
        };
        normalized.transition = {
          fromStatus: event.payload?.changelog?.items?.find(i => i.field === 'status')?.fromString,
          toStatus: event.payload?.changelog?.items?.find(i => i.field === 'status')?.toString,
        };
        break;

      case 'GITHUB':
        normalized.pr = event.payload?.pull_request ? {
          number: event.payload.pull_request.number,
          title: event.payload.pull_request.title,
          author: event.payload.pull_request.user?.login,
          state: event.payload.pull_request.state,
          merged: event.payload.pull_request.merged,
          url: event.payload.pull_request.html_url,
        } : null;
        normalized.repo = {
          name: event.payload?.repository?.full_name,
          owner: event.payload?.repository?.owner?.login,
        };
        normalized.action = event.payload?.action;
        break;

      case 'SLACK':
        normalized.message = {
          text: event.payload?.event?.text,
          channel: event.payload?.event?.channel,
          user: event.payload?.event?.user,
          ts: event.payload?.event?.ts,
        };
        break;

      case 'GMAIL':
        normalized.email = {
          id: event.payload?.id,
          from: event.payload?.from,
          to: event.payload?.to,
          subject: event.payload?.subject,
          body: event.payload?.snippet || event.payload?.body,
          threadId: event.payload?.threadId,
        };
        break;

      case 'TRELLO':
        normalized.card = {
          id: event.payload?.action?.data?.card?.id,
          name: event.payload?.action?.data?.card?.name,
          list: event.payload?.action?.data?.list?.name,
          board: event.payload?.action?.data?.board?.name,
        };
        break;
    }

    return normalized;
  }

  async updateEventStatus(eventId, status, matchedRuleIds) {
    await this.query(
      `UPDATE webhook_events SET status = $1, matched_rule_ids = $2, processed_at = NOW()
       WHERE id = $3`,
      [status, JSON.stringify(matchedRuleIds), eventId]
    );
  }

  // ============================================
  // WORKFLOW 5: RULE EVALUATOR
  // Match events against rules with conditions
  // ============================================

  async findMatchingRules(event) {
    const result = await this.query(
      `SELECT * FROM automation_rules
       WHERE status = 'active' AND trigger_type = 'event'
       AND trigger_config->>'app' = $1`,
      [event.app]
    );

    return result.rows.filter(rule => {
      const config = rule.trigger_config;

      // Check event type
      if (config.event && !this.matchEventType(config.event, event.type)) {
        return false;
      }

      // Check filters
      if (config.filters && !this.matchFilters(event, config.filters)) {
        return false;
      }

      // Check conditions
      if (rule.conditions && !this.matchConditions(event, rule.conditions)) {
        return false;
      }

      return true;
    });
  }

  matchEventType(expectedEvent, actualType) {
    // Handle variations in event naming
    const expected = expectedEvent.toLowerCase().replace(/_/g, '');
    const actual = actualType.toLowerCase().replace(/_/g, '');
    return expected === actual || actual.includes(expected);
  }

  matchFilters(event, filters) {
    for (const [key, value] of Object.entries(filters)) {
      const eventValue = this.getNestedValue(event, key) || this.getNestedValue(event.raw, key);

      if (Array.isArray(value)) {
        if (!value.includes(eventValue)) return false;
      } else if (typeof value === 'object' && value !== null) {
        // Complex filter
        if (value.contains && !String(eventValue).includes(value.contains)) return false;
        if (value.matches && !new RegExp(value.matches).test(String(eventValue))) return false;
        if (value.equals && eventValue !== value.equals) return false;
      } else if (eventValue !== value) {
        return false;
      }
    }
    return true;
  }

  matchConditions(event, conditions) {
    for (const condition of conditions) {
      const fieldValue = this.getNestedValue(event, condition.field);

      switch (condition.operator) {
        case 'equals':
          if (fieldValue !== condition.value) return false;
          break;
        case 'not_equals':
          if (fieldValue === condition.value) return false;
          break;
        case 'contains':
          if (!String(fieldValue).includes(condition.value)) return false;
          break;
        case 'matches':
          if (!new RegExp(condition.value).test(String(fieldValue))) return false;
          break;
        case 'gt':
          if (!(fieldValue > condition.value)) return false;
          break;
        case 'lt':
          if (!(fieldValue < condition.value)) return false;
          break;
        case 'in':
          if (!condition.value.includes(fieldValue)) return false;
          break;
        case 'not_in':
          if (condition.value.includes(fieldValue)) return false;
          break;
      }
    }
    return true;
  }

  getNestedValue(obj, path) {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  // ============================================
  // WORKFLOW 6: EXECUTOR
  // Execute rule actions reliably
  // ============================================

  async executeRule(rule, event) {
    console.log(`[AutomationEngine] Executing rule: ${rule.name}`);

    const config = rule.action_config || rule.actionConfig;
    const executionId = uuidv4();

    // Create execution record
    await this.createExecution(executionId, rule, event);

    try {
      // Prepare action params (apply templates)
      const params = this.applyTemplates(config, event);

      // Execute the action through Composio using executeAction
      const entityId = `user_${rule.user_id}`;
      const execResult = await this.composio.executeAction(config.tool, params, entityId);

      // Convert to expected format
      const result = {
        data: execResult.data,
        error: execResult.error,
        successful: execResult.success,
      };

      // Update execution record
      await this.updateExecution(executionId, execResult.success ? 'success' : 'failed', result);

      // Update rule stats
      await this.updateRuleStats(rule.id, true);

      // Clear failure tracking
      this.healthState.consecutiveFailures.delete(rule.id);
      this.healthState.failedRules.delete(rule.id);

      return result;
    } catch (error) {
      // Update execution record with error
      await this.updateExecution(executionId, 'failed', null, error.message);

      // Update rule error count
      await this.updateRuleStats(rule.id, false, error.message);

      // Track for health monitoring
      this.trackFailure(rule.id, error);

      throw error;
    }
  }

  async createExecution(executionId, rule, event) {
    const dedupeKey = this.generateDedupeKey(rule.id, event);

    await this.query(
      `INSERT INTO automation_executions (id, rule_id, user_id, trigger_event, status, dedupe_key, started_at)
       VALUES ($1, $2, $3, $4, 'running', $5, NOW())`,
      [executionId, rule.id, rule.user_id, JSON.stringify(event), dedupeKey]
    );
  }

  async updateExecution(executionId, status, result, errorMessage = null) {
    await this.query(
      `UPDATE automation_executions
       SET status = $1, result = $2, error_message = $3, completed_at = NOW()
       WHERE id = $4`,
      [status, JSON.stringify(result), errorMessage, executionId]
    );
  }

  async updateRuleStats(ruleId, success, errorMessage = null) {
    if (success) {
      await this.query(
        `UPDATE automation_rules
         SET trigger_count = trigger_count + 1, last_triggered_at = NOW()
         WHERE id = $1`,
        [ruleId]
      );
    } else {
      await this.query(
        `UPDATE automation_rules
         SET error_count = error_count + 1, last_error = $1
         WHERE id = $2`,
        [errorMessage, ruleId]
      );
    }
  }

  applyTemplates(actionConfig, event) {
    const params = { ...actionConfig.params };

    if (actionConfig.template) {
      if (typeof actionConfig.template === 'string') {
        params.text = this.interpolateTemplate(actionConfig.template, event);
        params.message = params.text;
      } else {
        for (const [key, template] of Object.entries(actionConfig.template)) {
          params[key] = this.interpolateTemplate(template, event);
        }
      }
    }

    return params;
  }

  interpolateTemplate(template, data) {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = this.getNestedValue(data, path.trim());
      return value !== undefined ? String(value) : match;
    });
  }

  // ============================================
  // WORKFLOW 7: DEDUPE & AUDIT
  // Prevent duplicates, track history
  // ============================================

  generateDedupeKey(ruleId, event) {
    // Create a unique key based on rule and event identifiers
    const eventKey = JSON.stringify({
      app: event.app,
      type: event.type,
      id: event.raw?.id || event.raw?.issue?.key || event.raw?.pull_request?.number || Date.now(),
    });

    return `${ruleId}_${Buffer.from(eventKey).toString('base64').slice(0, 32)}`;
  }

  async checkDedupe(ruleId, event) {
    const dedupeKey = this.generateDedupeKey(ruleId, event);

    // Check in-memory cache first
    if (this.dedupeCache.has(dedupeKey)) {
      const cached = this.dedupeCache.get(dedupeKey);
      if (Date.now() - cached.timestamp < 60 * 60 * 1000) { // 1 hour window
        return true;
      }
    }

    // Check database
    try {
      const result = await this.query(
        `SELECT id FROM automation_executions
         WHERE dedupe_key = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [dedupeKey]
      );

      if (result.rows.length > 0) {
        // Update cache
        this.dedupeCache.set(dedupeKey, { timestamp: Date.now() });
        return true;
      }
    } catch (error) {
      console.error('[AutomationEngine] Dedupe check error:', error);
    }

    return false;
  }

  async markProcessed(ruleId, event) {
    const dedupeKey = this.generateDedupeKey(ruleId, event);
    this.dedupeCache.set(dedupeKey, { timestamp: Date.now() });

    // Clean old entries periodically
    if (this.dedupeCache.size > 10000) {
      const now = Date.now();
      for (const [key, value] of this.dedupeCache.entries()) {
        if (now - value.timestamp > 2 * 60 * 60 * 1000) { // 2 hours
          this.dedupeCache.delete(key);
        }
      }
    }
  }

  async getAuditLog(ruleId, limit = 50) {
    const result = await this.query(
      `SELECT ae.*, ar.name as rule_name
       FROM automation_executions ae
       JOIN automation_rules ar ON ae.rule_id = ar.id
       WHERE ae.rule_id = $1
       ORDER BY ae.created_at DESC
       LIMIT $2`,
      [ruleId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      ruleName: row.rule_name,
      status: row.status,
      triggerEvent: row.trigger_event,
      result: row.result,
      error: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      duration: row.completed_at ? new Date(row.completed_at) - new Date(row.started_at) : null,
    }));
  }

  // ============================================
  // WORKFLOW 8: MONITORING & SELF-HEAL
  // Health checks and auto-recovery
  // ============================================

  trackFailure(ruleId, error) {
    const current = this.healthState.consecutiveFailures.get(ruleId) || 0;
    this.healthState.consecutiveFailures.set(ruleId, current + 1);

    if (current + 1 >= 5) {
      this.healthState.failedRules.add(ruleId);
      console.warn(`[AutomationEngine] Rule ${ruleId} marked as failing (${current + 1} consecutive failures)`);

      // Auto-pause if too many failures
      this.autoPauseRule(ruleId);
    }
  }

  async autoPauseRule(ruleId) {
    console.log(`[AutomationEngine] Auto-pausing rule ${ruleId} due to repeated failures`);

    await this.query(
      `UPDATE automation_rules
       SET status = 'paused', last_error = 'Auto-paused: Too many consecutive failures'
       WHERE id = $1`,
      [ruleId]
    );

    // Stop scheduled job if any
    const job = this.scheduledJobs.get(ruleId);
    if (job) {
      job.stop();
      this.scheduledJobs.delete(ruleId);
    }
  }

  async runHealthCheck() {
    console.log('[AutomationEngine] Running health check');

    this.healthState.lastCheck = new Date();
    const issues = [];

    // Check for rules with high error rates
    const errorRates = await this.query(
      `SELECT id, name, trigger_count, error_count,
              CASE WHEN trigger_count > 0 THEN error_count::float / trigger_count ELSE 0 END as error_rate
       FROM automation_rules
       WHERE status = 'active' AND trigger_count > 5
         AND CASE WHEN trigger_count > 0 THEN error_count::float / trigger_count ELSE 0 END > 0.5`,
      []
    );

    for (const rule of errorRates.rows) {
      issues.push({
        type: 'high_error_rate',
        ruleId: rule.id,
        ruleName: rule.name,
        errorRate: rule.error_rate,
        message: `Rule "${rule.name}" has ${Math.round(rule.error_rate * 100)}% error rate`,
      });
    }

    // Check for stalled scheduled jobs
    const scheduledRules = await this.query(
      `SELECT * FROM automation_rules
       WHERE status = 'active' AND trigger_type = 'schedule'`,
      []
    );

    for (const rule of scheduledRules.rows) {
      if (!this.scheduledJobs.has(rule.id)) {
        issues.push({
          type: 'stalled_schedule',
          ruleId: rule.id,
          ruleName: rule.name,
          message: `Scheduled rule "${rule.name}" is not running`,
        });

        // Self-heal: restart the scheduled job
        this.scheduleRule(rule);
      }
    }

    // Check for expired delayed executions
    try {
      const expiredDelayed = await this.query(
        `SELECT * FROM delayed_executions
         WHERE status = 'pending' AND scheduled_for < NOW() - INTERVAL '5 minutes'`,
        []
      );

      for (const delayed of expiredDelayed.rows) {
        issues.push({
          type: 'expired_delayed',
          executionId: delayed.id,
          ruleId: delayed.rule_id,
          message: `Delayed execution ${delayed.id} expired without running`,
        });

        // Self-heal: mark as expired and try to execute
        await this.query(
          'UPDATE delayed_executions SET status = $1 WHERE id = $2',
          ['expired', delayed.id]
        );
      }
    } catch (err) {
      console.error('[AutomationEngine] Error checking delayed executions:', err.message);
    }

    this.healthState.isHealthy = issues.length === 0;

    return {
      healthy: this.healthState.isHealthy,
      checkTime: this.healthState.lastCheck,
      issues,
      stats: {
        activeScheduledJobs: this.scheduledJobs.size,
        failingRules: this.healthState.failedRules.size,
        dedupeCacheSize: this.dedupeCache.size,
      },
    };
  }

  async recoverRule(ruleId) {
    console.log(`[AutomationEngine] Attempting to recover rule ${ruleId}`);

    // Clear failure tracking
    this.healthState.consecutiveFailures.delete(ruleId);
    this.healthState.failedRules.delete(ruleId);

    // Reactivate the rule
    await this.query(
      `UPDATE automation_rules SET status = 'active', last_error = NULL WHERE id = $1`,
      [ruleId]
    );

    // Restart scheduler if needed
    const rule = await this.query('SELECT * FROM automation_rules WHERE id = $1', [ruleId]);
    if (rule.rows.length > 0 && rule.rows[0].trigger_type === 'schedule') {
      this.scheduleRule(rule.rows[0]);
    }

    return { recovered: true, ruleId };
  }

  // ============================================
  // STANDARD CRUD OPERATIONS
  // ============================================

  async saveRule(ruleData) {
    const ruleId = uuidv4();

    await this.query(
      `INSERT INTO automation_rules (id, user_id, name, description, trigger_type, trigger_config, action_type, action_config, conditions, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        ruleId,
        ruleData.userId,
        ruleData.name,
        ruleData.description,
        ruleData.triggerType,
        JSON.stringify(ruleData.triggerConfig),
        ruleData.actionType,
        JSON.stringify(ruleData.actionConfig),
        JSON.stringify(ruleData.conditions || []),
        ruleData.status,
      ]
    );

    return { id: ruleId, ...ruleData };
  }

  async getRules(userId) {
    const result = await this.query(
      `SELECT * FROM automation_rules WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      triggerType: row.trigger_type,
      triggerConfig: row.trigger_config,
      actionConfig: row.action_config,
      conditions: row.conditions,
      status: row.status,
      triggerCount: row.trigger_count,
      errorCount: row.error_count,
      lastTriggeredAt: row.last_triggered_at,
      lastError: row.last_error,
      createdAt: row.created_at,
    }));
  }

  async updateRuleStatus(ruleId, status) {
    await this.query(
      'UPDATE automation_rules SET status = $1 WHERE id = $2',
      [status, ruleId]
    );

    if (status === 'paused') {
      const job = this.scheduledJobs.get(ruleId);
      if (job) {
        job.stop();
        this.scheduledJobs.delete(ruleId);
      }
    } else if (status === 'active') {
      // Restart scheduler if needed
      const rule = await this.query('SELECT * FROM automation_rules WHERE id = $1', [ruleId]);
      if (rule.rows.length > 0 && rule.rows[0].trigger_type === 'schedule') {
        this.scheduleRule(rule.rows[0]);
      }
    }
  }

  async deleteRule(ruleId) {
    // Stop any scheduled job
    const job = this.scheduledJobs.get(ruleId);
    if (job) {
      job.stop();
      this.scheduledJobs.delete(ruleId);
    }

    // Delete executions first (foreign key)
    await this.query('DELETE FROM automation_executions WHERE rule_id = $1', [ruleId]);

    // Delete the rule
    await this.query('DELETE FROM automation_rules WHERE id = $1', [ruleId]);
  }

  async getExecutionHistory(ruleId, limit = 20) {
    const result = await this.query(
      `SELECT * FROM automation_executions
       WHERE rule_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [ruleId, limit]
    );

    return result.rows;
  }

  async initializeScheduledRules() {
    const result = await this.query(
      `SELECT * FROM automation_rules WHERE status = 'active' AND trigger_type = 'schedule'`
    );

    for (const rule of result.rows) {
      this.scheduleRule(rule);
    }

    console.log(`[AutomationEngine] Initialized ${result.rows.length} scheduled rules`);

    // Start health check interval
    setInterval(() => this.runHealthCheck(), 5 * 60 * 1000); // Every 5 minutes
  }

  async startScheduler() {
    return this.initializeScheduledRules();
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  getRuleTemplates() {
    return this.ruleTemplates;
  }

  getHealthStatus() {
    return {
      healthy: this.healthState.isHealthy,
      lastCheck: this.healthState.lastCheck,
      failingRules: Array.from(this.healthState.failedRules),
      activeJobs: this.scheduledJobs.size,
    };
  }
}

module.exports = AutomationEngine;
