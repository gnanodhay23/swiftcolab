/**
 * StepClassifications - Action classification for execution policy decisions
 *
 * Classifies each action by:
 * - Reversibility: Can it be undone?
 * - Risk level: How dangerous is this action?
 * - Side effects: What happens when this runs?
 *
 * Used by ExecutionPolicyEngine to decide:
 * - Which policy to use (best-effort, checkpoint, all-or-nothing)
 * - Where to insert checkpoints
 * - What recovery options to offer
 */

// Reversibility levels
const REVERSIBILITY = {
  REVERSIBLE: 'reversible',       // Can be fully undone
  PARTIAL: 'partial',             // Can be undone but leaves traces
  IRREVERSIBLE: 'irreversible',   // Cannot be undone
};

// Risk levels
const RISK_LEVEL = {
  LOW: 'low',           // Safe, minimal consequences
  MEDIUM: 'medium',     // Some caution needed
  HIGH: 'high',         // Requires confirmation
  CRITICAL: 'critical', // Requires explicit confirmation
};

// Reversal complexity
const REVERSAL_COMPLEXITY = {
  SIMPLE: 'simple',     // One API call
  MEDIUM: 'medium',     // May have side effects
  COMPLEX: 'complex',   // Multiple steps, fees, etc.
  IMPOSSIBLE: null,     // Cannot be reversed
};

/**
 * Step classifications - metadata about each action type
 */
const STEP_CLASSIFICATIONS = {
  // ========== GOOGLE CALENDAR ==========
  GOOGLECALENDAR_CREATE_EVENT: {
    reversibility: REVERSIBILITY.REVERSIBLE,
    reversal_action: 'GOOGLECALENDAR_DELETE_EVENT',
    reversal_complexity: REVERSAL_COMPLEXITY.SIMPLE,
    base_risk_score: 0.3,
    side_effects: {
      notifications_sent: true,
      notification_delay_seconds: 0,
      visibility: 'attendees_see_immediately',
    },
    risk_level: RISK_LEVEL.LOW,
    risk_factors: ['attendees_notified'],
  },

  GOOGLECALENDAR_FIND_EVENT: {
    reversibility: REVERSIBILITY.REVERSIBLE, // Read-only
    reversal_action: null,
    reversal_complexity: null,
    base_risk_score: 0,
    side_effects: {},
    risk_level: RISK_LEVEL.LOW,
    risk_factors: [],
  },

  GOOGLECALENDAR_UPDATE_EVENT: {
    reversibility: REVERSIBILITY.PARTIAL,
    reversal_action: 'GOOGLECALENDAR_UPDATE_EVENT', // Update back
    reversal_complexity: REVERSAL_COMPLEXITY.MEDIUM,
    base_risk_score: 0.3,
    side_effects: {
      notifications_sent: true,
      notification_delay_seconds: 0,
      visibility: 'attendees_see_changes',
    },
    risk_level: RISK_LEVEL.LOW,
    risk_factors: ['attendees_notified_of_changes'],
  },

  GOOGLECALENDAR_DELETE_EVENT: {
    reversibility: REVERSIBILITY.IRREVERSIBLE,
    reversal_action: null,
    reversal_complexity: REVERSAL_COMPLEXITY.IMPOSSIBLE,
    base_risk_score: 0.5,
    side_effects: {
      notifications_sent: true,
      notification_delay_seconds: 0,
      visibility: 'attendees_see_cancellation',
      data_lost: true,
    },
    risk_level: RISK_LEVEL.MEDIUM,
    risk_factors: ['data_deletion', 'attendees_notified'],
  },

  GOOGLECALENDAR_FIND_FREE_SLOTS: {
    reversibility: REVERSIBILITY.REVERSIBLE,
    reversal_action: null,
    reversal_complexity: null,
    base_risk_score: 0,
    side_effects: {},
    risk_level: RISK_LEVEL.LOW,
    risk_factors: [],
  },

  // ========== GMAIL ==========
  GMAIL_SEND_EMAIL: {
    reversibility: REVERSIBILITY.IRREVERSIBLE,
    reversal_action: null,
    reversal_complexity: REVERSAL_COMPLEXITY.IMPOSSIBLE,
    base_risk_score: 0.7,
    side_effects: {
      delivered_immediately: true,
      cannot_unsend: true,
      appears_in_sent: true,
    },
    risk_level: RISK_LEVEL.HIGH,
    risk_factors: ['cannot_undo', 'external_recipients', 'reputation_impact'],
  },

  GMAIL_CREATE_EMAIL_DRAFT: {
    reversibility: REVERSIBILITY.REVERSIBLE,
    reversal_action: 'GMAIL_DELETE_DRAFT',
    reversal_complexity: REVERSAL_COMPLEXITY.SIMPLE,
    base_risk_score: 0.1,
    side_effects: {
      notifications_sent: false,
      visibility: 'only_sender',
    },
    risk_level: RISK_LEVEL.LOW,
    risk_factors: [],
  },

  GMAIL_FETCH_EMAILS: {
    reversibility: REVERSIBILITY.REVERSIBLE,
    reversal_action: null,
    reversal_complexity: null,
    base_risk_score: 0.1,
    side_effects: {
      may_mark_read: true,
      access_logged: true,
    },
    risk_level: RISK_LEVEL.LOW,
    risk_factors: ['implicit_read_status'],
  },

  GMAIL_REPLY_TO_THREAD: {
    reversibility: REVERSIBILITY.IRREVERSIBLE,
    reversal_action: null,
    reversal_complexity: REVERSAL_COMPLEXITY.IMPOSSIBLE,
    base_risk_score: 0.6,
    side_effects: {
      delivered_immediately: true,
      cannot_unsend: true,
      updates_thread: true,
    },
    risk_level: RISK_LEVEL.HIGH,
    risk_factors: ['cannot_undo', 'thread_visible_to_others'],
  },

  // ========== SLACK ==========
  SLACK_SEND_MESSAGE: {
    reversibility: REVERSIBILITY.PARTIAL,
    reversal_action: 'SLACK_DELETE_MESSAGE',
    reversal_complexity: REVERSAL_COMPLEXITY.MEDIUM,
    base_risk_score: 0.5,
    side_effects: {
      notifications_sent: true,
      notification_delay_seconds: 0,
      visibility: 'channel_members',
      deletion_leaves_trace: true,
    },
    risk_level: RISK_LEVEL.MEDIUM,
    risk_factors: ['visible_to_others', 'deletion_shows_placeholder'],
  },

  SLACK_LIST_CHANNELS: {
    reversibility: REVERSIBILITY.REVERSIBLE,
    reversal_action: null,
    reversal_complexity: null,
    base_risk_score: 0,
    side_effects: {},
    risk_level: RISK_LEVEL.LOW,
    risk_factors: [],
  },

  // ========== JIRA ==========
  JIRA_CREATE_ISSUE: {
    reversibility: REVERSIBILITY.REVERSIBLE,
    reversal_action: 'JIRA_DELETE_ISSUE',
    reversal_complexity: REVERSAL_COMPLEXITY.MEDIUM,
    base_risk_score: 0.3,
    side_effects: {
      notifications_sent: true,
      watchers_notified: true,
      appears_in_search: true,
    },
    risk_level: RISK_LEVEL.LOW,
    risk_factors: ['watchers_notified'],
  },

  JIRA_SEARCH_ISSUES: {
    reversibility: REVERSIBILITY.REVERSIBLE,
    reversal_action: null,
    reversal_complexity: null,
    base_risk_score: 0.1,
    side_effects: {
      updates_recently_viewed: true,
      access_logged: true,
    },
    risk_level: RISK_LEVEL.LOW,
    risk_factors: [],
  },

  JIRA_UPDATE_ISSUE: {
    reversibility: REVERSIBILITY.PARTIAL,
    reversal_action: 'JIRA_UPDATE_ISSUE',
    reversal_complexity: REVERSAL_COMPLEXITY.MEDIUM,
    base_risk_score: 0.3,
    side_effects: {
      notifications_sent: true,
      history_entry_created: true,
      watchers_notified: true,
    },
    risk_level: RISK_LEVEL.LOW,
    risk_factors: ['creates_history', 'watchers_notified'],
  },

  JIRA_GET_ALL_PROJECTS: {
    reversibility: REVERSIBILITY.REVERSIBLE,
    reversal_action: null,
    reversal_complexity: null,
    base_risk_score: 0,
    side_effects: {},
    risk_level: RISK_LEVEL.LOW,
    risk_factors: [],
  },

  // ========== FRAPPE ==========
  FRAPPE_CREATE_TASK: {
    reversibility: REVERSIBILITY.REVERSIBLE,
    reversal_action: 'FRAPPE_DELETE_TASK',
    reversal_complexity: REVERSAL_COMPLEXITY.SIMPLE,
    base_risk_score: 0.2,
    side_effects: {
      notifications_sent: false,
      appears_in_list: true,
    },
    risk_level: RISK_LEVEL.LOW,
    risk_factors: [],
  },

  FRAPPE_LIST_TASKS: {
    reversibility: REVERSIBILITY.REVERSIBLE,
    reversal_action: null,
    reversal_complexity: null,
    base_risk_score: 0,
    side_effects: {},
    risk_level: RISK_LEVEL.LOW,
    risk_factors: [],
  },

  FRAPPE_CREATE_CUSTOMER: {
    reversibility: REVERSIBILITY.REVERSIBLE,
    reversal_action: 'FRAPPE_DELETE_CUSTOMER',
    reversal_complexity: REVERSAL_COMPLEXITY.MEDIUM,
    base_risk_score: 0.3,
    side_effects: {
      appears_in_master_data: true,
    },
    risk_level: RISK_LEVEL.LOW,
    risk_factors: [],
  },

  FRAPPE_CREATE_SALES_ORDER: {
    reversibility: REVERSIBILITY.PARTIAL,
    reversal_action: 'FRAPPE_CANCEL_SALES_ORDER',
    reversal_complexity: REVERSAL_COMPLEXITY.MEDIUM,
    base_risk_score: 0.5,
    side_effects: {
      affects_inventory: true,
      may_affect_accounting: true,
    },
    risk_level: RISK_LEVEL.MEDIUM,
    risk_factors: ['financial_impact', 'inventory_reservation'],
  },

  FRAPPE_CREATE_SALES_INVOICE: {
    reversibility: REVERSIBILITY.PARTIAL,
    reversal_action: 'FRAPPE_CANCEL_SALES_INVOICE',
    reversal_complexity: REVERSAL_COMPLEXITY.COMPLEX,
    base_risk_score: 0.7,
    side_effects: {
      affects_accounting: true,
      may_affect_customer_balance: true,
      audit_trail: true,
    },
    risk_level: RISK_LEVEL.HIGH,
    risk_factors: ['financial_impact', 'accounting_entries', 'audit_requirements'],
  },
};

/**
 * Calculate dynamic risk score for a step based on parameters
 * @param {string} action - Action name
 * @param {Object} params - Action parameters
 * @returns {number} Risk score 0-1
 */
function calculateStepRisk(action, params = {}) {
  const classification = STEP_CLASSIFICATIONS[action];

  if (!classification) {
    // Unknown action - treat as medium risk
    return 0.5;
  }

  let riskScore = classification.base_risk_score;

  // Apply action-specific risk amplifiers
  switch (action) {
    case 'GMAIL_SEND_EMAIL':
      // Recipient count amplifies risk
      const to = Array.isArray(params.to) ? params.to : (params.to ? [params.to] : []);
      const cc = Array.isArray(params.cc) ? params.cc : (params.cc ? [params.cc] : []);
      const bcc = Array.isArray(params.bcc) ? params.bcc : (params.bcc ? [params.bcc] : []);
      const recipientCount = to.length + cc.length + bcc.length;

      if (recipientCount > 10) riskScore += 0.15;
      if (recipientCount > 50) riskScore += 0.2;
      if (recipientCount > 100) riskScore += 0.15;

      // External recipients amplify risk
      if (hasExternalRecipients([...to, ...cc, ...bcc])) {
        riskScore += 0.15;
      }

      // Attachments add slight risk
      if (params.attachments && params.attachments.length > 0) {
        riskScore += 0.05;
      }
      break;

    case 'SLACK_SEND_MESSAGE':
      // Public channels are riskier
      if (params.channel && !params.channel.startsWith('D')) {
        riskScore += 0.1;
      }

      // @channel or @here mentions are high risk
      if (params.text && (params.text.includes('<!channel>') || params.text.includes('<!here>'))) {
        riskScore += 0.3;
      }
      break;

    case 'GOOGLECALENDAR_CREATE_EVENT':
      // Many attendees amplify risk
      const attendees = Array.isArray(params.attendees) ? params.attendees : [];
      if (attendees.length > 10) riskScore += 0.1;
      if (attendees.length > 20) riskScore += 0.1;

      // External attendees amplify risk
      if (hasExternalRecipients(attendees.map(a => typeof a === 'string' ? a : a.email))) {
        riskScore += 0.15;
      }
      break;

    case 'JIRA_CREATE_ISSUE':
      // Issues in production projects may be riskier
      if (params.project && /prod|live|main/i.test(params.project)) {
        riskScore += 0.1;
      }
      break;

    case 'FRAPPE_CREATE_SALES_INVOICE':
    case 'FRAPPE_CREATE_SALES_ORDER':
      // Financial amount affects risk
      if (params.grand_total && params.grand_total > 10000) {
        riskScore += 0.1;
      }
      if (params.grand_total && params.grand_total > 100000) {
        riskScore += 0.2;
      }
      break;
  }

  // Cap at 1.0
  return Math.min(riskScore, 1.0);
}

/**
 * Check if any recipients are external (different domain)
 * @param {string[]} recipients - Email addresses
 * @returns {boolean}
 */
function hasExternalRecipients(recipients) {
  if (!recipients || recipients.length === 0) return false;

  // Extract domains
  const domains = recipients
    .filter(r => r && r.includes('@'))
    .map(r => r.split('@')[1]?.toLowerCase())
    .filter(Boolean);

  if (domains.length === 0) return false;

  // Get the most common domain (assumed to be internal)
  const domainCounts = {};
  for (const d of domains) {
    domainCounts[d] = (domainCounts[d] || 0) + 1;
  }

  const internalDomain = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  // Check if any domain differs from internal
  return domains.some(d => d !== internalDomain);
}

/**
 * Get external domains from recipients
 * @param {string[]} recipients - Email addresses
 * @returns {string[]} External domain names
 */
function getExternalDomains(recipients) {
  if (!recipients || recipients.length === 0) return [];

  const domains = recipients
    .filter(r => r && r.includes('@'))
    .map(r => r.split('@')[1]?.toLowerCase())
    .filter(Boolean);

  if (domains.length === 0) return [];

  const domainCounts = {};
  for (const d of domains) {
    domainCounts[d] = (domainCounts[d] || 0) + 1;
  }

  const internalDomain = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  return [...new Set(domains.filter(d => d !== internalDomain))];
}

/**
 * Get classification for an action
 * @param {string} action - Action name
 * @returns {Object|null} Classification or null if unknown
 */
function getClassification(action) {
  return STEP_CLASSIFICATIONS[action] || null;
}

/**
 * Check if an action is reversible
 * @param {string} action - Action name
 * @returns {boolean}
 */
function isReversible(action) {
  const classification = STEP_CLASSIFICATIONS[action];
  return classification?.reversibility === REVERSIBILITY.REVERSIBLE;
}

/**
 * Check if an action is irreversible
 * @param {string} action - Action name
 * @returns {boolean}
 */
function isIrreversible(action) {
  const classification = STEP_CLASSIFICATIONS[action];
  return classification?.reversibility === REVERSIBILITY.IRREVERSIBLE;
}

/**
 * Get the reversal action for an action
 * @param {string} action - Action name
 * @returns {string|null} Reversal action name or null
 */
function getReversalAction(action) {
  const classification = STEP_CLASSIFICATIONS[action];
  return classification?.reversal_action || null;
}

/**
 * Check if an action is high risk
 * @param {string} action - Action name
 * @param {Object} params - Action parameters
 * @returns {boolean}
 */
function isHighRisk(action, params = {}) {
  return calculateStepRisk(action, params) > 0.6;
}

/**
 * Check if an action is critical risk
 * @param {string} action - Action name
 * @param {Object} params - Action parameters
 * @returns {boolean}
 */
function isCriticalRisk(action, params = {}) {
  return calculateStepRisk(action, params) > 0.8;
}

/**
 * Get risk factors for an action with params
 * @param {string} action - Action name
 * @param {Object} params - Action parameters
 * @returns {string[]} Risk factors
 */
function getRiskFactors(action, params = {}) {
  const classification = STEP_CLASSIFICATIONS[action];
  if (!classification) return ['unknown_action'];

  const factors = [...(classification.risk_factors || [])];

  // Add dynamic risk factors based on params
  switch (action) {
    case 'GMAIL_SEND_EMAIL':
      const to = Array.isArray(params.to) ? params.to : (params.to ? [params.to] : []);
      const cc = Array.isArray(params.cc) ? params.cc : [];
      const bcc = Array.isArray(params.bcc) ? params.bcc : [];
      const recipientCount = to.length + cc.length + bcc.length;

      if (recipientCount > 10) factors.push('large_recipient_list');
      if (hasExternalRecipients([...to, ...cc, ...bcc])) {
        factors.push('external_recipients');
      }
      break;

    case 'SLACK_SEND_MESSAGE':
      if (params.text?.includes('<!channel>')) factors.push('channel_mention');
      if (params.text?.includes('<!here>')) factors.push('here_mention');
      break;

    case 'GOOGLECALENDAR_CREATE_EVENT':
      const attendees = Array.isArray(params.attendees) ? params.attendees : [];
      if (attendees.length > 20) factors.push('many_attendees');
      if (hasExternalRecipients(attendees.map(a => typeof a === 'string' ? a : a.email))) {
        factors.push('external_attendees');
      }
      break;
  }

  return [...new Set(factors)];
}

module.exports = {
  STEP_CLASSIFICATIONS,
  REVERSIBILITY,
  RISK_LEVEL,
  REVERSAL_COMPLEXITY,
  calculateStepRisk,
  getClassification,
  isReversible,
  isIrreversible,
  getReversalAction,
  isHighRisk,
  isCriticalRisk,
  getRiskFactors,
  hasExternalRecipients,
  getExternalDomains,
};
