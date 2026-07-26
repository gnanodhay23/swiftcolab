/**
 * WorkflowGates - Stop workflows when upstream data is empty
 *
 * Prevents useless operations like:
 * - Sending empty emails when Jira returns 0 tickets
 * - Creating calendar events with no attendees from empty search
 * - Posting to Slack with no content
 *
 * Instead of continuing blindly, we pause and ask the user what to do.
 */

// Actions that produce data for downstream tasks
const DATA_PRODUCING_ACTIONS = {
  // Jira
  'JIRA_SEARCH_ISSUES': {
    dataPath: ['data', 'issues'],
    countPath: ['data', 'total'],
    emptyMessage: 'No Jira tickets found matching your criteria.',
    suggestions: [
      'Try removing filters (like assignee)',
      'Search in a different project',
      'Check if the project key is correct',
    ],
  },
  'JIRA_GET_ISSUES': {
    dataPath: ['data', 'issues'],
    emptyMessage: 'No Jira issues found.',
  },
  'JIRA_GET_ISSUE': {
    dataPath: ['data'],
    emptyMessage: 'Jira issue not found.',
  },

  // Gmail
  'GMAIL_FETCH_EMAILS': {
    dataPath: ['data', 'messages'],
    emptyMessage: 'No emails found matching your search.',
    suggestions: [
      'Try a broader search query',
      'Check if the email address is correct',
      'Look in a different folder',
    ],
  },
  'GMAIL_FIND_EMAIL': {
    dataPath: ['data', 'messages'],
    emptyMessage: 'No emails found.',
  },

  // Calendar
  'GOOGLECALENDAR_FIND_EVENT': {
    dataPath: ['data', 'items'],
    emptyMessage: 'No calendar events found.',
    suggestions: [
      'Try a different date range',
      'Check the event name spelling',
    ],
  },
  'GOOGLECALENDAR_GET_EVENTS': {
    dataPath: ['data', 'items'],
    emptyMessage: 'No calendar events in this time range.',
  },

  // Slack
  'SLACK_LIST_CHANNELS': {
    dataPath: ['data', 'channels'],
    emptyMessage: 'No Slack channels found.',
  },
  'SLACK_SEARCH_MESSAGES': {
    dataPath: ['data', 'messages'],
    emptyMessage: 'No Slack messages found.',
  },

  // Trello
  'TRELLO_GET_CARDS': {
    dataPath: ['data', 'cards'],
    emptyMessage: 'No Trello cards found.',
  },
  'TRELLO_GET_LISTS': {
    dataPath: ['data', 'lists'],
    emptyMessage: 'No Trello lists found.',
  },

  // Frappe
  'FRAPPE_GET_DOCUMENTS': {
    dataPath: ['data', 'data'],
    emptyMessage: 'No Frappe documents found.',
  },
};

// Actions that consume upstream data (need data to work)
const DATA_CONSUMING_ACTIONS = [
  // Email sending - needs content to send
  'GMAIL_SEND_EMAIL',

  // Slack posting - needs content
  'SLACK_SEND_MESSAGE',
  'SLACK_SEND_CHANNEL_MESSAGE',

  // Calendar - might need attendees from search
  'GOOGLECALENDAR_CREATE_EVENT',

  // Bulk operations
  'JIRA_BULK_UPDATE',
  'GMAIL_BULK_SEND',

  // Formatting operations that need data
  'FORMAT_JIRA_TICKETS',
  'FORMAT_CALENDAR_EVENTS',
  'FORMAT_EMAIL_SUMMARY',
];

class WorkflowGates {
  constructor() {
    this.dataProducingActions = DATA_PRODUCING_ACTIONS;
    this.dataConsumingActions = DATA_CONSUMING_ACTIONS;
  }

  /**
   * Evaluate whether workflow should continue after a task result
   *
   * @param {object} taskResult - { action, data, success }
   * @param {array} remainingTasks - Tasks yet to be executed
   * @param {object} context - Workflow context
   * @returns {object} - { shouldContinue, reason, message, options }
   */
  evaluate(taskResult, remainingTasks, context = {}) {
    const { action, data, success } = taskResult;

    // If task failed, let error handling take over
    if (!success) {
      return { shouldContinue: true, reason: 'task_failed' };
    }

    // Check if this is a data-producing action
    const producerConfig = this.dataProducingActions[action];
    if (!producerConfig) {
      // Not a data producer - continue normally
      return { shouldContinue: true };
    }

    // Check if data is empty
    const isEmpty = this._checkIfEmpty(data, producerConfig);

    if (!isEmpty) {
      // Data exists - continue normally
      return { shouldContinue: true };
    }

    // Data is empty - check if downstream tasks need it
    const hasDataDependentTasks = this._hasDataDependentTasks(remainingTasks);

    if (!hasDataDependentTasks) {
      // No downstream tasks need data - continue (maybe just informational query)
      return {
        shouldContinue: true,
        warning: producerConfig.emptyMessage,
      };
    }

    // Empty data AND downstream tasks need it - STOP workflow
    console.log(`[WorkflowGates] Stopping workflow: ${action} returned empty data`);

    return {
      shouldContinue: false,
      reason: 'empty_upstream_data',
      action,
      message: this._buildUserMessage(action, producerConfig, context),
      options: this._buildOptions(action, context),
      suggestions: producerConfig.suggestions || [],
    };
  }

  /**
   * Check if result data is empty
   */
  _checkIfEmpty(data, config) {
    if (!data) return true;

    // Navigate to the data path
    let value = data;
    for (const key of config.dataPath) {
      if (value === null || value === undefined) return true;
      value = value[key];
    }

    // Check emptiness
    if (Array.isArray(value)) {
      return value.length === 0;
    }

    if (typeof value === 'object') {
      return Object.keys(value).length === 0;
    }

    return !value;
  }

  /**
   * Check if remaining tasks depend on upstream data
   */
  _hasDataDependentTasks(remainingTasks) {
    if (!remainingTasks || remainingTasks.length === 0) {
      return false;
    }

    for (const task of remainingTasks) {
      const action = task.action || task;
      if (this.dataConsumingActions.includes(action)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Build user-friendly message explaining the situation
   */
  _buildUserMessage(action, config, context) {
    let message = config.emptyMessage;

    // Add context-specific details
    if (action === 'JIRA_SEARCH_ISSUES') {
      if (context.jql) {
        message += `\n\nSearch query used: \`${context.jql}\``;
      }
      if (context.hadAssigneeFilter) {
        message += '\n\nNote: The search included an assignee filter which may have excluded results.';
      }
    }

    if (action.includes('GMAIL') && context.query) {
      message += `\n\nSearch: "${context.query}"`;
    }

    return message;
  }

  /**
   * Build response options for user
   */
  _buildOptions(action, context) {
    const options = [
      {
        id: 'retry_different',
        label: 'Try with different criteria',
        description: 'Modify the search and try again',
      },
      {
        id: 'cancel',
        label: 'Cancel workflow',
        description: 'Stop here, don\'t send anything',
      },
    ];

    // Action-specific options
    if (action === 'JIRA_SEARCH_ISSUES') {
      options.unshift({
        id: 'retry_all',
        label: 'Search all tickets (remove filters)',
        description: 'Get all accessible tickets without assignee/status filters',
      });
    }

    if (action.includes('GMAIL')) {
      options.push({
        id: 'compose_manual',
        label: 'Compose email manually',
        description: 'I\'ll write the content myself',
      });
    }

    return options;
  }

  /**
   * Check if action is a data producer
   */
  isDataProducer(action) {
    return action in this.dataProducingActions;
  }

  /**
   * Check if action is a data consumer
   */
  isDataConsumer(action) {
    return this.dataConsumingActions.includes(action);
  }

  /**
   * Get expected data structure for an action
   */
  getDataStructure(action) {
    return this.dataProducingActions[action] || null;
  }

  /**
   * Count items in result data
   */
  countItems(action, data) {
    const config = this.dataProducingActions[action];
    if (!config) return null;

    let value = data;
    for (const key of config.dataPath) {
      if (value === null || value === undefined) return 0;
      value = value[key];
    }

    if (Array.isArray(value)) {
      return value.length;
    }

    return value ? 1 : 0;
  }
}

// Singleton
const workflowGates = new WorkflowGates();

// Helper functions
function evaluateGate(taskResult, remainingTasks, context) {
  return workflowGates.evaluate(taskResult, remainingTasks, context);
}

function isDataProducer(action) {
  return workflowGates.isDataProducer(action);
}

function isDataConsumer(action) {
  return workflowGates.isDataConsumer(action);
}

function countResultItems(action, data) {
  return workflowGates.countItems(action, data);
}

module.exports = {
  WorkflowGates,
  evaluateGate,
  isDataProducer,
  isDataConsumer,
  countResultItems,
  DATA_PRODUCING_ACTIONS,
  DATA_CONSUMING_ACTIONS,
};
