/**
 * ExecutionPolicyEngine - Intelligent Multi-Step Execution with Checkpoints
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │              EXECUTION POLICY ENGINE                                    │
 * │                                                                         │
 * │  Plan ──→ ┌──────────────────┐                                         │
 * │           │ Step Classification│──→ Risk score per step                │
 * │           └────────┬─────────┘                                         │
 * │                    ↓                                                    │
 * │           ┌──────────────────┐                                         │
 * │           │ Policy Selection │──→ Best-effort / Checkpoint / All-or-none│
 * │           └────────┬─────────┘                                         │
 * │                    ↓                                                    │
 * │           ┌──────────────────┐                                         │
 * │           │ Checkpoint Insert│──→ Pause points before high-risk steps  │
 * │           └────────┬─────────┘                                         │
 * │                    ↓                                                    │
 * │           ┌──────────────────┐                                         │
 * │           │ Execute + Track  │──→ Ledger with step outcomes            │
 * │           └────────┬─────────┘                                         │
 * │                    ↓                                                    │
 * │           ┌──────────────────┐                                         │
 * │           │ Failure Recovery │──→ Options: retry, rollback, keep partial│
 * │           └──────────────────┘                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Policies:
 * - BEST_EFFORT: Continue on failure, report per-step
 * - CHECKPOINT: Pause before high-risk steps, confirm with user
 * - ALL_OR_NOTHING: Rollback on any failure
 */

const { v4: uuidv4 } = require('uuid');
const {
  STEP_CLASSIFICATIONS,
  REVERSIBILITY,
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
} = require('./StepClassifications');

// Execution policies
const EXECUTION_POLICIES = {
  BEST_EFFORT: 'best_effort',
  CHECKPOINT: 'checkpoint',
  ALL_OR_NOTHING: 'all_or_nothing',
};

// Step execution statuses
const STEP_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'success',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  ROLLED_BACK: 'rolled_back',
};

// Checkpoint actions
const CHECKPOINT_ACTIONS = {
  PROCEED: 'proceed',
  SKIP: 'skip_step',
  ABORT: 'abort',
  MODIFY: 'modify',
  REVIEW: 'review',
};

class ExecutionPolicyEngine {
  constructor(options = {}) {
    this.defaultPolicy = options.defaultPolicy || EXECUTION_POLICIES.BEST_EFFORT;
    this.highRiskThreshold = options.highRiskThreshold || 0.6;
    this.criticalRiskThreshold = options.criticalRiskThreshold || 0.8;
    this.checkpointCallback = options.checkpointCallback || null;
    this.rollbackCallback = options.rollbackCallback || null;
  }

  /**
   * Analyze a plan and determine execution strategy
   * @param {Object} plan - Execution plan with steps
   * @returns {Object} Analysis with policy recommendation and checkpoints
   */
  analyzePlan(plan) {
    const steps = plan.steps || [];
    const analysis = {
      stepCount: steps.length,
      stepAnalysis: [],
      hasIrreversible: false,
      hasHighRisk: false,
      hasCriticalRisk: false,
      allIndependent: true,
      recommendedPolicy: EXECUTION_POLICIES.BEST_EFFORT,
      checkpoints: [],
      totalRiskScore: 0,
    };

    // Analyze each step
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const action = step.action;
      const params = step.params || {};

      const riskScore = calculateStepRisk(action, params);
      const classification = getClassification(action);
      const riskFactors = getRiskFactors(action, params);

      const stepAnalysis = {
        index: i,
        stepId: step.id,
        action,
        riskScore,
        reversibility: classification?.reversibility || REVERSIBILITY.IRREVERSIBLE,
        reversalAction: classification?.reversal_action,
        riskLevel: riskScore > 0.8 ? 'critical' : riskScore > 0.6 ? 'high' : riskScore > 0.3 ? 'medium' : 'low',
        riskFactors,
        hasDependencies: !!(step.dependsOn && step.dependsOn.length > 0),
      };

      analysis.stepAnalysis.push(stepAnalysis);
      analysis.totalRiskScore += riskScore;

      // Track plan characteristics
      if (isIrreversible(action)) {
        analysis.hasIrreversible = true;
      }
      if (riskScore > this.highRiskThreshold) {
        analysis.hasHighRisk = true;
      }
      if (riskScore > this.criticalRiskThreshold) {
        analysis.hasCriticalRisk = true;
      }
      if (stepAnalysis.hasDependencies) {
        analysis.allIndependent = false;
      }
    }

    // Determine checkpoints
    analysis.checkpoints = this._determineCheckpoints(steps, analysis.stepAnalysis);

    // Select policy
    analysis.recommendedPolicy = this._selectPolicy(plan, analysis);

    return analysis;
  }

  /**
   * Determine where to insert checkpoints
   */
  _determineCheckpoints(steps, stepAnalysis) {
    const checkpoints = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const analysis = stepAnalysis[i];
      let needsCheckpoint = false;
      let checkpointReason = null;

      // Rule 1: Before any irreversible step
      if (analysis.reversibility === REVERSIBILITY.IRREVERSIBLE) {
        needsCheckpoint = true;
        checkpointReason = 'irreversible_action';
      }

      // Rule 2: Before high-risk step if preceded by successful steps
      if (analysis.riskScore > this.highRiskThreshold && i > 0) {
        needsCheckpoint = true;
        checkpointReason = checkpointReason || 'high_risk_after_success';
      }

      // Rule 3: Before step with large audience
      if (analysis.riskFactors.includes('large_recipient_list') ||
          analysis.riskFactors.includes('many_attendees') ||
          analysis.riskFactors.includes('channel_mention')) {
        needsCheckpoint = true;
        checkpointReason = checkpointReason || 'large_audience';
      }

      // Rule 4: Before external-facing step
      if (analysis.riskFactors.includes('external_recipients') ||
          analysis.riskFactors.includes('external_attendees')) {
        needsCheckpoint = true;
        checkpointReason = checkpointReason || 'external_recipients';
      }

      // Rule 5: Before step that depends on previous output (review opportunity)
      if (step.usesOutputFromPrevious || step.dependsOn?.length > 0) {
        needsCheckpoint = true;
        checkpointReason = checkpointReason || 'review_intermediate_result';
      }

      if (needsCheckpoint) {
        checkpoints.push({
          beforeStep: i,
          stepId: step.id,
          reason: checkpointReason,
          action: step.action,
          riskScore: analysis.riskScore,
          riskFactors: analysis.riskFactors,
        });
      }
    }

    return checkpoints;
  }

  /**
   * Select the appropriate execution policy
   */
  _selectPolicy(plan, analysis) {
    // User can explicitly request a policy
    if (plan.requestedPolicy) {
      return plan.requestedPolicy;
    }

    // Critical risk = always checkpoint
    if (analysis.hasCriticalRisk) {
      return EXECUTION_POLICIES.CHECKPOINT;
    }

    // Irreversible + high risk = checkpoint
    if (analysis.hasIrreversible && analysis.hasHighRisk) {
      return EXECUTION_POLICIES.CHECKPOINT;
    }

    // Semantically atomic request = all-or-nothing
    if (plan.isSemanticAtomic || plan.atomicRequired) {
      return EXECUTION_POLICIES.ALL_OR_NOTHING;
    }

    // Multiple checkpoints needed = checkpoint policy
    if (analysis.checkpoints.length >= 2) {
      return EXECUTION_POLICIES.CHECKPOINT;
    }

    // Default: best effort
    return EXECUTION_POLICIES.BEST_EFFORT;
  }

  /**
   * Create an execution ledger to track execution state
   */
  createLedger(plan, analysis) {
    return {
      id: `ledger_${uuidv4()}`,
      planId: plan.id,
      policy: analysis.recommendedPolicy,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      steps: analysis.stepAnalysis.map((sa, i) => ({
        index: i,
        stepId: plan.steps[i].id,
        action: sa.action,
        status: STEP_STATUS.PENDING,
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        artifact: null,
        riskScore: sa.riskScore,
        reversibility: sa.reversibility,
        reversalAction: sa.reversalAction,
      })),
      checkpoints: analysis.checkpoints.map(cp => ({
        ...cp,
        presentedAt: null,
        userResponse: null,
        respondedAt: null,
      })),
      recoveryOptions: null,
    };
  }

  /**
   * Update ledger when step starts
   */
  markStepStarted(ledger, stepIndex) {
    const step = ledger.steps[stepIndex];
    if (step) {
      step.status = STEP_STATUS.IN_PROGRESS;
      step.startedAt = new Date().toISOString();
    }
    if (ledger.status === 'pending') {
      ledger.status = 'running';
      ledger.startedAt = new Date().toISOString();
    }
    return ledger;
  }

  /**
   * Update ledger when step succeeds
   */
  markStepSuccess(ledger, stepIndex, result, artifact = null) {
    const step = ledger.steps[stepIndex];
    if (step) {
      step.status = STEP_STATUS.SUCCESS;
      step.completedAt = new Date().toISOString();
      step.result = result;
      step.artifact = artifact || this._extractArtifact(step.action, result);
    }
    return ledger;
  }

  /**
   * Update ledger when step fails
   */
  markStepFailed(ledger, stepIndex, error, retryable = false) {
    const step = ledger.steps[stepIndex];
    if (step) {
      step.status = STEP_STATUS.FAILED;
      step.completedAt = new Date().toISOString();
      step.error = {
        message: typeof error === 'string' ? error : error.message,
        code: error.code || 'UNKNOWN',
        retryable,
        retryAfterSeconds: error.retryAfterSeconds || null,
      };
    }
    return ledger;
  }

  /**
   * Update ledger when step is skipped
   */
  markStepSkipped(ledger, stepIndex, reason = 'user_skipped') {
    const step = ledger.steps[stepIndex];
    if (step) {
      step.status = STEP_STATUS.SKIPPED;
      step.completedAt = new Date().toISOString();
      step.error = { message: reason, code: 'SKIPPED', retryable: false };
    }
    return ledger;
  }

  /**
   * Record checkpoint interaction
   */
  recordCheckpoint(ledger, checkpointIndex, response) {
    const checkpoint = ledger.checkpoints[checkpointIndex];
    if (checkpoint) {
      checkpoint.userResponse = response;
      checkpoint.respondedAt = new Date().toISOString();
    }
    return ledger;
  }

  /**
   * Extract artifact from step result for potential rollback
   */
  _extractArtifact(action, result) {
    if (!result) return null;

    const data = result.data || result;

    switch (action) {
      case 'GOOGLECALENDAR_CREATE_EVENT':
        return {
          type: 'calendar_event',
          id: data.id || data.eventId,
          htmlLink: data.htmlLink,
          reversible: true,
          reversalAction: 'GOOGLECALENDAR_DELETE_EVENT',
        };

      case 'GMAIL_CREATE_EMAIL_DRAFT':
        return {
          type: 'email_draft',
          id: data.id || data.draftId,
          reversible: true,
          reversalAction: 'GMAIL_DELETE_DRAFT',
        };

      case 'GMAIL_SEND_EMAIL':
        return {
          type: 'sent_email',
          id: data.id || data.messageId,
          threadId: data.threadId,
          reversible: false,
          reversalAction: null,
        };

      case 'SLACK_SEND_MESSAGE':
        return {
          type: 'slack_message',
          ts: data.ts,
          channel: data.channel,
          reversible: true, // Partial - leaves trace
          reversalAction: 'SLACK_DELETE_MESSAGE',
        };

      case 'JIRA_CREATE_ISSUE':
        return {
          type: 'jira_issue',
          key: data.key,
          id: data.id,
          selfUrl: data.self,
          reversible: true,
          reversalAction: 'JIRA_DELETE_ISSUE',
        };

      default:
        return null;
    }
  }

  /**
   * Generate recovery options based on ledger state
   */
  generateRecoveryOptions(ledger) {
    const completedSteps = ledger.steps.filter(s => s.status === STEP_STATUS.SUCCESS);
    const failedSteps = ledger.steps.filter(s => s.status === STEP_STATUS.FAILED);
    const skippedSteps = ledger.steps.filter(s => s.status === STEP_STATUS.SKIPPED);

    const options = [];

    // Option 1: Retry failed steps
    const retryableFailures = failedSteps.filter(s => s.error?.retryable);
    if (retryableFailures.length > 0) {
      const retryAfter = Math.max(...retryableFailures.map(s => s.error.retryAfterSeconds || 0));
      options.push({
        id: 'retry_failed',
        label: `Retry ${this._describeSteps(retryableFailures)}`,
        action: 'retry',
        steps: retryableFailures.map(s => s.index),
        available: true,
        retryAfterSeconds: retryAfter,
      });
    }

    // Option 2: Rollback completed steps
    const reversibleCompleted = completedSteps.filter(s =>
      s.artifact?.reversible && s.reversalAction
    );
    if (reversibleCompleted.length > 0) {
      const warnings = this._generateRollbackWarnings(reversibleCompleted);
      options.push({
        id: 'rollback',
        label: `Undo ${this._describeSteps(reversibleCompleted)}`,
        action: 'rollback',
        steps: reversibleCompleted.map(s => s.index),
        available: true,
        warnings,
        requiresConfirmation: warnings.length > 0,
      });
    }

    // Option 3: Keep partial success
    if (completedSteps.length > 0 && failedSteps.length > 0) {
      options.push({
        id: 'keep_partial',
        label: "Keep what succeeded, I'll handle the rest",
        action: 'accept_partial',
        available: true,
      });
    }

    // Option 4: Retry all failed (non-retryable ones too)
    if (failedSteps.length > 0 && failedSteps.length !== retryableFailures.length) {
      options.push({
        id: 'retry_all_failed',
        label: `Force retry all failed steps`,
        action: 'retry_force',
        steps: failedSteps.map(s => s.index),
        available: true,
      });
    }

    // Option 5: Manual resolution
    options.push({
      id: 'manual',
      label: 'Show me the details, I\'ll fix it manually',
      action: 'show_details',
      available: true,
    });

    ledger.recoveryOptions = options;
    return options;
  }

  /**
   * Describe steps for display
   */
  _describeSteps(steps) {
    if (steps.length === 1) {
      return this._getActionDisplayName(steps[0].action);
    }
    if (steps.length === 2) {
      return `${this._getActionDisplayName(steps[0].action)} and ${this._getActionDisplayName(steps[1].action)}`;
    }
    return `${steps.length} steps`;
  }

  /**
   * Get user-friendly action name
   */
  _getActionDisplayName(action) {
    const displayNames = {
      'GOOGLECALENDAR_CREATE_EVENT': 'calendar event',
      'GOOGLECALENDAR_DELETE_EVENT': 'calendar event deletion',
      'GMAIL_SEND_EMAIL': 'email',
      'GMAIL_CREATE_EMAIL_DRAFT': 'email draft',
      'SLACK_SEND_MESSAGE': 'Slack message',
      'JIRA_CREATE_ISSUE': 'Jira ticket',
    };
    return displayNames[action] || action.toLowerCase().replace(/_/g, ' ');
  }

  /**
   * Generate warnings for rollback operations
   */
  _generateRollbackWarnings(steps) {
    const warnings = [];
    const now = new Date();

    for (const step of steps) {
      const timeSince = step.completedAt
        ? (now - new Date(step.completedAt)) / 1000
        : 0;

      switch (step.action) {
        case 'GOOGLECALENDAR_CREATE_EVENT':
          if (step.artifact) {
            warnings.push({
              severity: 'medium',
              message: 'Calendar invites may have already been sent to attendees',
            });
            warnings.push({
              severity: 'medium',
              message: 'Attendees will receive a cancellation notice',
            });
          }
          break;

        case 'SLACK_SEND_MESSAGE':
          warnings.push({
            severity: 'low',
            message: 'Deleting will leave a "message deleted" placeholder',
          });
          if (timeSince > 300) { // 5 minutes
            warnings.push({
              severity: 'medium',
              message: 'Message may have already been read by channel members',
            });
          }
          break;

        case 'JIRA_CREATE_ISSUE':
          if (timeSince > 30) {
            warnings.push({
              severity: 'low',
              message: 'Watchers may have already been notified',
            });
          }
          break;
      }

      // Generic time-based warning
      if (timeSince > 120) { // 2 minutes
        warnings.push({
          severity: 'info',
          message: `This was created ${this._formatDuration(timeSince)} ago and may have been seen`,
        });
      }
    }

    // Deduplicate warnings by message
    const unique = [];
    const seen = new Set();
    for (const w of warnings) {
      if (!seen.has(w.message)) {
        seen.add(w.message);
        unique.push(w);
      }
    }

    return unique;
  }

  /**
   * Format duration for display
   */
  _formatDuration(seconds) {
    if (seconds < 60) return `${Math.round(seconds)} seconds`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
    return `${Math.round(seconds / 3600)} hours`;
  }

  /**
   * Generate checkpoint UI content
   */
  generateCheckpointUI(completedSteps, nextStep, checkpoint, params = {}) {
    const completedSummary = completedSteps.map(step => ({
      action: this._getActionDisplayName(step.action),
      result: this._summarizeResult(step),
      artifact: step.artifact,
    }));

    const nextDescription = this._describeUpcomingStep(nextStep, params);
    const reason = checkpoint.reason;

    // Generate message and options based on reason
    if (reason === 'large_audience') {
      const recipientCount = this._getRecipientCount(nextStep.action, params);
      return {
        message: this._buildCheckpointMessage(completedSummary, nextDescription, {
          additionalInfo: `This will notify ${recipientCount} people.`,
        }),
        options: [
          { label: 'Send now', action: CHECKPOINT_ACTIONS.PROCEED },
          { label: 'Review recipients', action: CHECKPOINT_ACTIONS.REVIEW, data: 'recipients' },
          { label: 'Skip this step', action: CHECKPOINT_ACTIONS.SKIP },
          { label: 'Cancel everything', action: CHECKPOINT_ACTIONS.ABORT },
        ],
      };
    }

    if (reason === 'external_recipients') {
      const externalDomains = this._getExternalDomains(nextStep.action, params);
      return {
        message: this._buildCheckpointMessage(completedSummary, nextDescription, {
          additionalInfo: `This includes external recipients at: ${externalDomains.join(', ')}`,
        }),
        options: [
          { label: 'Send to everyone', action: CHECKPOINT_ACTIONS.PROCEED },
          { label: 'Remove external recipients', action: CHECKPOINT_ACTIONS.MODIFY, modification: 'internal_only' },
          { label: 'Review recipients', action: CHECKPOINT_ACTIONS.REVIEW, data: 'recipients' },
          { label: 'Skip this step', action: CHECKPOINT_ACTIONS.SKIP },
        ],
      };
    }

    if (reason === 'irreversible_action') {
      return {
        message: this._buildCheckpointMessage(completedSummary, nextDescription, {
          warning: '⚠️ This action cannot be undone.',
        }),
        options: [
          { label: 'Yes, proceed', action: CHECKPOINT_ACTIONS.PROCEED },
          { label: 'Skip this step', action: CHECKPOINT_ACTIONS.SKIP },
          { label: 'Cancel', action: CHECKPOINT_ACTIONS.ABORT },
        ],
      };
    }

    if (reason === 'review_intermediate_result') {
      return {
        message: this._buildCheckpointMessage(completedSummary, `Before I ${nextDescription}, would you like to review?`),
        options: [
          { label: 'Looks good, continue', action: CHECKPOINT_ACTIONS.PROCEED },
          { label: 'Let me review first', action: CHECKPOINT_ACTIONS.REVIEW },
          { label: 'Make changes', action: CHECKPOINT_ACTIONS.MODIFY },
        ],
      };
    }

    // Default checkpoint
    return {
      message: this._buildCheckpointMessage(completedSummary, `Ready to proceed with: ${nextDescription}?`),
      options: [
        { label: 'Yes, continue', action: CHECKPOINT_ACTIONS.PROCEED },
        { label: 'Skip this step', action: CHECKPOINT_ACTIONS.SKIP },
        { label: 'Cancel', action: CHECKPOINT_ACTIONS.ABORT },
      ],
    };
  }

  /**
   * Build checkpoint message
   */
  _buildCheckpointMessage(completedSummary, nextDescription, extras = {}) {
    let message = '';

    if (completedSummary.length > 0) {
      message += "I've completed:\n\n";
      for (const step of completedSummary) {
        const link = step.artifact?.htmlLink ? ` [View →](${step.artifact.htmlLink})` : '';
        message += `✓ ${step.result}${link}\n`;
      }
      message += '\n';
    }

    if (extras.warning) {
      message += `${extras.warning}\n\n`;
    }

    message += nextDescription;

    if (extras.additionalInfo) {
      message += `\n\n${extras.additionalInfo}`;
    }

    return message;
  }

  /**
   * Summarize a step result for display
   */
  _summarizeResult(step) {
    if (!step.result) return `Completed ${this._getActionDisplayName(step.action)}`;

    const data = step.result.data || step.result;

    switch (step.action) {
      case 'GOOGLECALENDAR_CREATE_EVENT':
        return `Created meeting "${data.summary || 'Event'}" for ${data.start?.dateTime || data.start?.date || 'scheduled time'}`;

      case 'GMAIL_SEND_EMAIL':
        return `Sent email to ${data.to || 'recipients'}`;

      case 'GMAIL_CREATE_EMAIL_DRAFT':
        return `Created email draft "${data.subject || 'Draft'}"`;

      case 'SLACK_SEND_MESSAGE':
        return `Posted message to ${data.channel || 'channel'}`;

      case 'JIRA_CREATE_ISSUE':
        return `Created Jira ticket ${data.key || ''}`;

      default:
        return `Completed ${this._getActionDisplayName(step.action)}`;
    }
  }

  /**
   * Describe upcoming step
   */
  _describeUpcomingStep(step, params) {
    const action = step.action;

    switch (action) {
      case 'GMAIL_SEND_EMAIL':
        return `send an email to ${params.to || 'recipients'}`;

      case 'SLACK_SEND_MESSAGE':
        return `post a message to ${params.channel || 'the channel'}`;

      case 'GOOGLECALENDAR_CREATE_EVENT':
        return `create a calendar event "${params.title || params.summary || 'Event'}"`;

      case 'JIRA_CREATE_ISSUE':
        return `create a Jira ticket in ${params.project || 'the project'}`;

      default:
        return this._getActionDisplayName(action);
    }
  }

  /**
   * Get recipient count from action params
   */
  _getRecipientCount(action, params) {
    switch (action) {
      case 'GMAIL_SEND_EMAIL':
        const to = Array.isArray(params.to) ? params.to : (params.to ? [params.to] : []);
        const cc = Array.isArray(params.cc) ? params.cc : [];
        const bcc = Array.isArray(params.bcc) ? params.bcc : [];
        return to.length + cc.length + bcc.length;

      case 'GOOGLECALENDAR_CREATE_EVENT':
        return Array.isArray(params.attendees) ? params.attendees.length : 0;

      default:
        return 0;
    }
  }

  /**
   * Get external domains from action params
   */
  _getExternalDomains(action, params) {
    switch (action) {
      case 'GMAIL_SEND_EMAIL':
        const to = Array.isArray(params.to) ? params.to : (params.to ? [params.to] : []);
        const cc = Array.isArray(params.cc) ? params.cc : [];
        const bcc = Array.isArray(params.bcc) ? params.bcc : [];
        return getExternalDomains([...to, ...cc, ...bcc]);

      case 'GOOGLECALENDAR_CREATE_EVENT':
        const attendees = Array.isArray(params.attendees) ? params.attendees : [];
        return getExternalDomains(attendees.map(a => typeof a === 'string' ? a : a.email));

      default:
        return [];
    }
  }

  /**
   * Build reversal params for an action
   */
  buildReversalParams(step) {
    const action = step.action;
    const artifact = step.artifact;
    const originalParams = step.params || {};

    if (!artifact) return null;

    switch (action) {
      case 'GOOGLECALENDAR_CREATE_EVENT':
        return {
          event_id: artifact.id,
          calendar_id: originalParams.calendar_id || 'primary',
          sendUpdates: 'all', // Notify attendees of cancellation
        };

      case 'GMAIL_CREATE_EMAIL_DRAFT':
        return {
          draft_id: artifact.id,
        };

      case 'SLACK_SEND_MESSAGE':
        return {
          channel: artifact.channel,
          ts: artifact.ts,
        };

      case 'JIRA_CREATE_ISSUE':
        return {
          issue_key: artifact.key,
        };

      default:
        return null;
    }
  }

  /**
   * Generate partial success message
   */
  generatePartialSuccessMessage(ledger) {
    const completed = ledger.steps.filter(s => s.status === STEP_STATUS.SUCCESS);
    const failed = ledger.steps.filter(s => s.status === STEP_STATUS.FAILED);

    let message = "I've completed part of your request:\n\n";

    // Show completed steps
    for (const step of completed) {
      const link = step.artifact?.htmlLink ? `\n  [View →](${step.artifact.htmlLink})` : '';
      message += `✓ ${this._summarizeResult(step)}${link}\n`;
    }

    message += '\n';

    // Show failed steps
    for (const step of failed) {
      const errorMsg = step.error?.message || 'Unknown error';
      message += `✗ Failed to ${this._describeUpcomingStep(step, step.params || {})}\n`;
      message += `  Error: ${errorMsg}\n`;
    }

    return message;
  }

  /**
   * Generate complete failure message
   */
  generateCompleteFailureMessage(ledger) {
    const failed = ledger.steps.filter(s => s.status === STEP_STATUS.FAILED);
    const skipped = ledger.steps.filter(s => s.status === STEP_STATUS.SKIPPED);

    let message = "I wasn't able to complete your request:\n\n";

    for (const step of failed) {
      const errorMsg = step.error?.message || 'Unknown error';
      message += `✗ Failed to ${this._describeUpcomingStep(step, step.params || {})}\n`;
      message += `  Error: ${errorMsg}\n`;
    }

    for (const step of skipped) {
      const reason = step.error?.message || 'depends on failed step';
      message += `✗ Skipped ${this._getActionDisplayName(step.action)} (${reason})\n`;
    }

    return message;
  }

  /**
   * Finalize ledger status
   */
  finalizeLedger(ledger) {
    const completed = ledger.steps.filter(s => s.status === STEP_STATUS.SUCCESS);
    const failed = ledger.steps.filter(s => s.status === STEP_STATUS.FAILED);
    const total = ledger.steps.length;

    if (failed.length === 0) {
      ledger.status = 'success';
    } else if (completed.length === 0) {
      ledger.status = 'failed';
    } else {
      ledger.status = 'partial_success';
    }

    ledger.completedAt = new Date().toISOString();
    ledger.summary = {
      total,
      completed: completed.length,
      failed: failed.length,
      skipped: ledger.steps.filter(s => s.status === STEP_STATUS.SKIPPED).length,
    };

    return ledger;
  }
}

// Singleton instance
let _defaultEngine = null;
function getExecutionPolicyEngine(options = {}) {
  if (!_defaultEngine) {
    _defaultEngine = new ExecutionPolicyEngine(options);
  }
  return _defaultEngine;
}

module.exports = {
  ExecutionPolicyEngine,
  EXECUTION_POLICIES,
  STEP_STATUS,
  CHECKPOINT_ACTIONS,
  getExecutionPolicyEngine,
};
