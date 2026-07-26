/**
 * TaskValidationOrchestrator - Coordinates validation of ALL parsed tasks
 *
 * NO HARDCODED LOGIC - Uses SchemaValidator + SchemaFetcher for dynamic validation
 * and DynamicQuestionGenerator for question generation.
 *
 * Key Features:
 * 1. Validates ALL tasks (not just first one)
 * 2. Analyzes data dependencies for auto-fill opportunities
 * 3. Generates dynamic questions for missing fields
 * 4. Returns consolidated validation result
 *
 * Example:
 * User: "send jira tickets to someone@email.com"
 * Tasks: [
 *   { id: "t1", action: "JIRA_SEARCH_ISSUES", params: {} },
 *   { id: "t2", action: "GMAIL_SEND_EMAIL", params: { to: "someone@email.com" }, dependsOn: ["t1"] }
 * ]
 *
 * Result:
 * {
 *   isReady: false,
 *   missingFields: [{ taskId: "t1", field: "project", question: "Which Jira project?", ... }],
 *   canAutoFill: [{ taskId: "t2", field: "body", sourceTaskId: "t1", sourcePath: "results" }]
 * }
 */

const { SchemaValidator } = require('./SchemaValidator');
const { DynamicQuestionGenerator } = require('./DynamicQuestionGenerator');

/**
 * Auto-fill mapping: Which output fields from one action can fill inputs of another
 * Format: { sourceAction: { outputField: [{ targetField, description }] } }
 * These are common patterns - actual auto-fill is determined dynamically
 */
const AUTO_FILL_PATTERNS = {
  // Jira search results can fill email/slack body
  JIRA_SEARCH_ISSUES: {
    results: [
      { targetField: 'body', description: 'Jira search results' },
      { targetField: 'message', description: 'Jira search results' },
      { targetField: 'text', description: 'Jira search results' },
    ],
    issues: [
      { targetField: 'body', description: 'Jira issues list' },
      { targetField: 'message', description: 'Jira issues list' },
    ],
  },

  // Jira create returns issue key that can be referenced
  JIRA_CREATE_ISSUE: {
    key: [
      { targetField: 'body', description: 'Created issue key' },
      { targetField: 'message', description: 'Created issue key' },
      { targetField: 'subject', description: 'Issue key for subject' },
    ],
    issue: [
      { targetField: 'body', description: 'Created issue details' },
    ],
  },

  // Calendar event can fill email body
  GOOGLECALENDAR_CREATE_EVENT: {
    event: [
      { targetField: 'body', description: 'Event details' },
      { targetField: 'message', description: 'Event details' },
    ],
    htmlLink: [
      { targetField: 'body', description: 'Event link' },
    ],
  },

  // Calendar find can fill email body
  GOOGLECALENDAR_FIND_EVENT: {
    events: [
      { targetField: 'body', description: 'Calendar events' },
      { targetField: 'message', description: 'Calendar events' },
    ],
  },

  // Gmail draft returns draft info
  GMAIL_CREATE_DRAFT: {
    draft: [
      { targetField: 'body', description: 'Draft content' },
    ],
  },

  // Slack returns message info
  SLACK_SEND_CHANNEL_MESSAGE: {
    message: [
      { targetField: 'body', description: 'Slack message' },
    ],
  },
};

/**
 * Fields that should NEVER be auto-filled - must always come from user
 */
const NEVER_AUTO_FILL = [
  'to',          // Email recipient - always ask user
  'cc',          // CC recipients
  'bcc',         // BCC recipients
  'channel',     // Slack channel - user must specify
  'channel_id',  // Slack channel ID
  'attendees',   // Calendar attendees
  'assignee',    // Jira assignee
];

/**
 * Fields that CAN be auto-filled from dependencies
 */
const CAN_AUTO_FILL = [
  'body',        // Email/message body from search results
  'message',     // Slack message from results
  'text',        // Generic text content
  'content',     // Generic content
  'description', // Can come from previous action
];

class TaskValidationOrchestrator {
  /**
   * @param {Object} options
   * @param {Object} options.schemaFetcher - SchemaFetcher instance for dynamic schema lookup
   * @param {Object} options.composioService - ComposioService for backup schema fetching
   */
  constructor({ schemaFetcher, composioService } = {}) {
    this.schemaFetcher = schemaFetcher;
    this.composioService = composioService;

    // Create SchemaValidator with SchemaFetcher
    this.validator = new SchemaValidator(schemaFetcher);

    // Question generator
    this.questionGenerator = new DynamicQuestionGenerator();
  }

  /**
   * Set the SchemaFetcher instance (for dependency injection)
   */
  setSchemaFetcher(schemaFetcher) {
    this.schemaFetcher = schemaFetcher;
    this.validator.setSchemaFetcher(schemaFetcher);
  }

  // ===========================================================================
  // PRIMARY METHOD: Validate All Tasks
  // ===========================================================================

  /**
   * Validate ALL parsed tasks and collect all missing fields
   *
   * @param {Array} tasks - Array of task objects with { id, action, params, dependsOn, toolkit }
   * @param {string} entityId - Optional entity ID for user-specific schemas
   * @returns {Promise<Object>} Consolidated validation result
   */
  async validateAllTasks(tasks, entityId = null) {
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return {
        isReady: true,
        taskValidations: new Map(),
        missingFields: [],
        canAutoFill: [],
        allTasks: [],
      };
    }

    console.log(`[TaskValidationOrchestrator] Validating ${tasks.length} tasks`);
    console.log(`[TaskValidationOrchestrator] Tasks:`, tasks.map(t => ({ id: t.id, action: t.action, params: Object.keys(t.params || {}) })));

    // Step 1: Analyze data dependencies between tasks
    const autoFillMap = this.analyzeDataDependencies(tasks);

    // Step 2: Validate each task and collect missing fields
    const taskValidations = new Map();
    const allMissingFields = [];
    const canAutoFill = [];

    for (const task of tasks) {
      // Validate this task
      console.log(`[TaskValidationOrchestrator] Validating task ${task.id}: ${task.action}`);
      console.log(`[TaskValidationOrchestrator] Task params:`, JSON.stringify(task.params));

      const validation = await this._validateSingleTask(task, entityId);
      console.log(`[TaskValidationOrchestrator] Task ${task.id} validation result:`, {
        isValid: validation.isValid,
        missingCount: validation.missingRequired?.length || 0,
        missingFields: validation.missingRequired?.map(m => m.field) || [],
      });

      taskValidations.set(task.id, validation);

      // Process missing fields
      console.log(`[TaskValidationOrchestrator] Task ${task.id} (${task.action}) - Processing ${validation.missingRequired.length} missing fields`);

      for (const missing of validation.missingRequired) {
        const fieldName = missing.field;
        console.log(`[TaskValidationOrchestrator] Task ${task.id} - Missing field: ${fieldName}`);

        // Check if this field can be auto-filled from a dependency
        const autoFillSource = this._findAutoFillSource(task, fieldName, autoFillMap);

        if (autoFillSource) {
          // This field can be auto-filled - don't ask user
          console.log(`[TaskValidationOrchestrator] Task ${task.id} - Field ${fieldName} can be auto-filled from ${autoFillSource.sourceTaskId}`);
          canAutoFill.push({
            taskId: task.id,
            field: fieldName,
            sourceTaskId: autoFillSource.sourceTaskId,
            sourcePath: autoFillSource.sourcePath,
            description: autoFillSource.description,
          });
        } else {
          // Must ask user for this field
          console.log(`[TaskValidationOrchestrator] Task ${task.id} - Field ${fieldName} requires user input`);
          const question = this.questionGenerator.generateQuestion(
            {
              name: fieldName,
              type: missing.type || 'string',
              description: missing.description || '',
              enum: missing.enum,
            },
            task.action
          );

          allMissingFields.push({
            taskId: task.id,
            actionName: task.action,
            toolkit: task.toolkit,
            field: fieldName,
            type: missing.type || 'string',
            description: missing.description || '',
            enum: missing.enum,
            question,
            required: true,
          });
        }
      }
    }

    // Step 3: Determine if ready to execute
    // isReady = true only if no fields need to be collected from user
    const isReady = allMissingFields.length === 0;

    console.log(`[TaskValidationOrchestrator] Validation complete:`, {
      isReady,
      missingCount: allMissingFields.length,
      autoFillCount: canAutoFill.length,
    });

    return {
      isReady,
      taskValidations,
      missingFields: allMissingFields,
      canAutoFill,
      allTasks: tasks,
    };
  }

  /**
   * Validate a single task against its schema
   * @private
   */
  async _validateSingleTask(task, entityId = null) {
    try {
      // Use SchemaValidator's validateTask method
      const result = await this.validator.validateTask(task, entityId);

      return {
        taskId: task.id,
        action: task.action,
        isValid: result.isValid,
        missingRequired: result.missingRequired || [],
        typeMismatches: result.typeMismatches || [],
        coercedParams: result.coerced || task.params || {},
      };
    } catch (error) {
      console.error(`[TaskValidationOrchestrator] Error validating task ${task.id}:`, error.message);

      // Fallback: try to get missing fields directly
      return await this._fallbackValidation(task, entityId);
    }
  }

  /**
   * Fallback validation when SchemaValidator fails
   * @private
   */
  async _fallbackValidation(task, entityId = null) {
    try {
      if (this.schemaFetcher) {
        const requiredFields = await this.schemaFetcher.getRequiredFields(task.action, entityId);
        const providedParams = task.params || {};
        const missingRequired = [];

        for (const field of requiredFields) {
          const value = providedParams[field.name];
          if (value === undefined || value === null || value === '') {
            missingRequired.push({
              field: field.name,
              type: field.type || 'string',
              description: field.description || '',
              enum: field.enum,
            });
          }
        }

        return {
          taskId: task.id,
          action: task.action,
          isValid: missingRequired.length === 0,
          missingRequired,
          typeMismatches: [],
          coercedParams: providedParams,
        };
      }
    } catch (e) {
      console.error(`[TaskValidationOrchestrator] Fallback validation error:`, e.message);
    }

    // Ultimate fallback - assume valid (can't determine)
    return {
      taskId: task.id,
      action: task.action,
      isValid: true,
      missingRequired: [],
      typeMismatches: [],
      coercedParams: task.params || {},
    };
  }

  // ===========================================================================
  // DATA DEPENDENCY ANALYSIS
  // ===========================================================================

  /**
   * Analyze data dependencies between tasks
   * Returns mapping of what outputs can fill what inputs
   *
   * @param {Array} tasks - Array of task objects
   * @returns {Map<string, Array>} Map of taskId -> possible auto-fills
   */
  analyzeDataDependencies(tasks) {
    const autoFillMap = new Map();

    for (const task of tasks) {
      const possibleFills = [];
      const dependsOn = task.dependsOn || [];

      // For each dependency, check what outputs could fill our inputs
      for (const depId of dependsOn) {
        const depTask = tasks.find(t => t.id === depId);
        if (!depTask) continue;

        // Get possible outputs from dependent task
        const outputPatterns = AUTO_FILL_PATTERNS[depTask.action] || {};

        // Check each output pattern
        for (const [outputField, targetFields] of Object.entries(outputPatterns)) {
          for (const target of targetFields) {
            // Only add if the target field can be auto-filled
            if (CAN_AUTO_FILL.includes(target.targetField)) {
              possibleFills.push({
                sourceTaskId: depId,
                sourceAction: depTask.action,
                sourcePath: outputField,
                targetField: target.targetField,
                description: target.description,
              });
            }
          }
        }

        // Also check for template references in params (e.g., {{t1.results}})
        const templateFills = this._findTemplateReferences(task.params, depId, depTask);
        possibleFills.push(...templateFills);
      }

      autoFillMap.set(task.id, possibleFills);
    }

    return autoFillMap;
  }

  /**
   * Find template references like {{t1.results}} in params
   * @private
   */
  _findTemplateReferences(params, depId, depTask) {
    const fills = [];
    if (!params) return fills;

    for (const [field, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        // Check for template pattern {{taskId.path}} or {{taskId}}
        const templatePattern = new RegExp(`\\{\\{${depId}(?:\\.([^}]+))?\\}\\}`, 'g');
        const match = templatePattern.exec(value);

        if (match) {
          fills.push({
            sourceTaskId: depId,
            sourceAction: depTask.action,
            sourcePath: match[1] || 'results',
            targetField: field,
            description: `Template reference from ${depTask.action}`,
            isTemplateReference: true,
          });
        }
      }
    }

    return fills;
  }

  /**
   * Find auto-fill source for a specific field
   * @private
   */
  _findAutoFillSource(task, fieldName, autoFillMap) {
    // Never auto-fill certain fields
    if (NEVER_AUTO_FILL.includes(fieldName)) {
      return null;
    }

    // Check if this task has dependencies that can provide this field
    const possibleFills = autoFillMap.get(task.id) || [];

    for (const fill of possibleFills) {
      if (fill.targetField === fieldName) {
        return fill;
      }
    }

    return null;
  }

  // ===========================================================================
  // FIELD AUTO-FILL CHECK
  // ===========================================================================

  /**
   * Check if a specific field can be auto-filled from dependencies
   *
   * @param {string} fieldName - Field name to check
   * @param {Array} taskDependencies - Array of dependent task IDs
   * @param {Object} previousTaskOutputs - Map of taskId -> output data
   * @returns {Object} { canFill: boolean, source?: string, value?: any }
   */
  canAutoFillField(fieldName, taskDependencies, previousTaskOutputs = {}) {
    // Never auto-fill certain fields
    if (NEVER_AUTO_FILL.includes(fieldName)) {
      return { canFill: false, reason: 'Field requires user input' };
    }

    // Check if this field can be auto-filled
    if (!CAN_AUTO_FILL.includes(fieldName)) {
      return { canFill: false, reason: 'Field type not auto-fillable' };
    }

    // Look for a dependency that has relevant output
    for (const depId of (taskDependencies || [])) {
      const output = previousTaskOutputs[depId];
      if (!output) continue;

      // Check if output has usable data for this field
      const autoFillValue = this._extractAutoFillValue(fieldName, output);

      if (autoFillValue !== null) {
        return {
          canFill: true,
          source: `task:${depId}`,
          value: autoFillValue,
        };
      }
    }

    return { canFill: false, reason: 'No suitable source found' };
  }

  /**
   * Extract auto-fill value from task output
   * @private
   */
  _extractAutoFillValue(fieldName, output) {
    if (!output) return null;

    // Handle different output structures
    const data = output.data || output;

    // For body/message fields, format output as readable text
    if (['body', 'message', 'text', 'content'].includes(fieldName)) {
      // Jira issues
      if (data.issues && Array.isArray(data.issues)) {
        return this._formatJiraIssues(data.issues);
      }

      // Calendar events
      if (data.events && Array.isArray(data.events)) {
        return this._formatCalendarEvents(data.events);
      }

      // Generic results
      if (data.results) {
        return JSON.stringify(data.results, null, 2);
      }

      // Single item
      if (data.key || data.id || data.summary) {
        return this._formatSingleItem(data);
      }
    }

    return null;
  }

  /**
   * Format Jira issues for email/message body
   * @private
   */
  _formatJiraIssues(issues) {
    if (!issues || issues.length === 0) return 'No issues found.';

    const lines = issues.slice(0, 10).map(issue => {
      const key = issue.key || issue.id;
      const summary = issue.fields?.summary || issue.summary || 'No summary';
      const status = issue.fields?.status?.name || issue.status || '';
      return `• ${key}: ${summary}${status ? ` [${status}]` : ''}`;
    });

    if (issues.length > 10) {
      lines.push(`... and ${issues.length - 10} more issues`);
    }

    return `Jira Issues:\n${lines.join('\n')}`;
  }

  /**
   * Format calendar events for email/message body
   * @private
   */
  _formatCalendarEvents(events) {
    if (!events || events.length === 0) return 'No events found.';

    const lines = events.slice(0, 10).map(event => {
      const summary = event.summary || 'Untitled event';
      const start = event.start?.dateTime || event.start?.date || '';
      return `• ${summary}${start ? ` - ${new Date(start).toLocaleString()}` : ''}`;
    });

    return `Calendar Events:\n${lines.join('\n')}`;
  }

  /**
   * Format single item (created issue, event, etc.)
   * @private
   */
  _formatSingleItem(data) {
    const parts = [];

    if (data.key) parts.push(`Key: ${data.key}`);
    if (data.id) parts.push(`ID: ${data.id}`);
    if (data.summary) parts.push(`Summary: ${data.summary}`);
    if (data.htmlLink) parts.push(`Link: ${data.htmlLink}`);

    return parts.join('\n') || JSON.stringify(data, null, 2);
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Get all fields that need user input (excluding auto-fillable)
   */
  getFieldsRequiringUserInput(validationResult) {
    return validationResult.missingFields.filter(field => {
      // Check if this field has an auto-fill source
      const hasAutoFill = validationResult.canAutoFill.some(
        af => af.taskId === field.taskId && af.field === field.field
      );
      return !hasAutoFill;
    });
  }

  /**
   * Generate consolidated questions for all missing fields
   */
  generateConsolidatedQuestions(missingFields) {
    return this.questionGenerator.generateAllQuestions(
      missingFields.map(field => ({
        field: field.field,
        action: field.actionName,
        type: field.type,
        description: field.description,
        enum: field.enum,
      }))
    );
  }

  /**
   * Group missing fields by task
   */
  groupFieldsByTask(missingFields) {
    // Returns a plain object: { taskId: [field1, field2, ...], ... }
    // This allows using Object.entries() and bracket notation
    const grouped = {};

    for (const field of missingFields) {
      const taskId = field.taskId;
      if (!grouped[taskId]) {
        grouped[taskId] = [];
      }
      grouped[taskId].push(field);
    }

    return grouped;
  }

  /**
   * Check if all tasks in a validation result can proceed
   */
  canProceed(validationResult) {
    // Can proceed if no missing fields that require user input
    return validationResult.missingFields.length === 0;
  }

  /**
   * Get summary of validation result
   */
  getSummary(validationResult) {
    const { isReady, missingFields, canAutoFill, taskValidations } = validationResult;

    return {
      ready: isReady,
      totalTasks: taskValidations.size,
      validTasks: Array.from(taskValidations.values()).filter(v => v.isValid).length,
      fieldsNeedingInput: missingFields.length,
      fieldsAutoFillable: canAutoFill.length,
      fieldsByTask: this.groupFieldsByTask(missingFields),
    };
  }
}

// Export class and constants
module.exports = {
  TaskValidationOrchestrator,
  AUTO_FILL_PATTERNS,
  NEVER_AUTO_FILL,
  CAN_AUTO_FILL,
};
