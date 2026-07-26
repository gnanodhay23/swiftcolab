/**
 * PartialSuccessDetector.js
 *
 * Specialized module for detecting partial success scenarios in action responses.
 * Each action type has specific indicators that suggest partial completion.
 */

const { SUB_STATUS } = require('./StatusMappings');

// =============================================================================
// PARTIAL SUCCESS INDICATORS BY ACTION
// =============================================================================

const PARTIAL_SUCCESS_INDICATORS = {
  // =========================================================================
  // GOOGLE CALENDAR
  // =========================================================================
  GOOGLECALENDAR_CREATE_EVENT: {
    checks: [
      {
        name: 'attendee_failures',
        condition: (response, params) => {
          const errors = response.attendeeErrors ||
                        response.data?.attendeeErrors ||
                        response.attendees_not_added ||
                        response.error?.errors?.filter(e => e.reason === 'attendeeError');
          return errors && errors.length > 0;
        },
        sub_status: SUB_STATUS.SOME_ATTENDEES_FAILED,
        extract: (response, params) => {
          const errors = response.attendeeErrors ||
                        response.data?.attendeeErrors ||
                        response.attendees_not_added || [];
          const allAttendees = params.attendees || [];
          return {
            total: allAttendees.length,
            succeeded: allAttendees.length - errors.length,
            failed: errors.map(e => ({
              email: e.email || e,
              reason: e.reason || 'unknown',
            })),
          };
        },
      },
      {
        name: 'notification_failure',
        condition: (response) => {
          return response.notificationsFailed === true ||
                 response.data?.notificationsFailed === true ||
                 response.sendUpdates === 'none' && response.attendees?.length > 0;
        },
        sub_status: SUB_STATUS.CREATED_WITHOUT_NOTIFICATIONS,
        extract: () => ({
          notifications_sent: false,
          reason: 'notification_delivery_failed',
        }),
      },
      {
        name: 'conference_creation_failure',
        condition: (response) => {
          const confData = response.conferenceData || response.data?.conferenceData;
          return confData?.createRequest?.status?.statusCode === 'failure';
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response) => ({
          conference_created: false,
          reason: response.conferenceData?.createRequest?.status?.statusCode || 'conference_creation_failed',
        }),
      },
    ],
  },

  GOOGLECALENDAR_UPDATE_EVENT: {
    checks: [
      {
        name: 'attendee_update_failures',
        condition: (response, params) => {
          const errors = response.attendeeErrors || response.data?.attendeeErrors;
          return errors && errors.length > 0;
        },
        sub_status: SUB_STATUS.SOME_ATTENDEES_FAILED,
        extract: (response, params) => {
          const errors = response.attendeeErrors || response.data?.attendeeErrors || [];
          return {
            failed: errors.map(e => ({
              email: e.email || e,
              reason: e.reason || 'update_failed',
            })),
          };
        },
      },
      {
        name: 'partial_field_update',
        condition: (response) => {
          return response.warnings && response.warnings.length > 0;
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response) => ({
          warnings: response.warnings,
        }),
      },
    ],
  },

  // =========================================================================
  // GMAIL
  // =========================================================================
  GMAIL_SEND_EMAIL: {
    checks: [
      {
        name: 'recipient_failures',
        condition: (response, params) => {
          const failed = response.failedRecipients ||
                        response.data?.failedRecipients ||
                        response.failed_recipients;
          return failed && failed.length > 0;
        },
        sub_status: SUB_STATUS.SOME_RECIPIENTS_FAILED,
        extract: (response, params) => {
          const failed = response.failedRecipients ||
                        response.data?.failedRecipients ||
                        response.failed_recipients || [];
          const to = params.to || params.recipients || [];
          const toList = Array.isArray(to) ? to : [to];
          return {
            total: toList.length,
            succeeded: toList.length - failed.length,
            failed: failed.map(f => ({
              email: typeof f === 'string' ? f : f.email,
              reason: typeof f === 'object' ? f.reason : 'delivery_failed',
            })),
          };
        },
      },
      {
        name: 'cc_bcc_failures',
        condition: (response) => {
          return (response.failedCc && response.failedCc.length > 0) ||
                 (response.failedBcc && response.failedBcc.length > 0);
        },
        sub_status: SUB_STATUS.SOME_RECIPIENTS_FAILED,
        extract: (response) => ({
          failed_cc: response.failedCc || [],
          failed_bcc: response.failedBcc || [],
        }),
      },
      {
        name: 'attachment_failures',
        condition: (response) => {
          return response.failedAttachments && response.failedAttachments.length > 0;
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response) => ({
          attachments_failed: response.failedAttachments,
        }),
      },
    ],
  },

  GMAIL_CREATE_EMAIL_DRAFT: {
    checks: [
      {
        name: 'attachment_failures',
        condition: (response) => {
          return response.failedAttachments && response.failedAttachments.length > 0;
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response) => ({
          attachments_failed: response.failedAttachments,
        }),
      },
    ],
  },

  // =========================================================================
  // SLACK
  // =========================================================================
  SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL: {
    checks: [
      {
        name: 'message_warnings',
        condition: (response) => {
          return response.warning ||
                 (response.response_metadata?.warnings && response.response_metadata.warnings.length > 0);
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response) => ({
          warnings: response.warning ||
                   response.response_metadata?.warnings ||
                   [],
        }),
      },
      {
        name: 'unfurl_failures',
        condition: (response) => {
          return response.unfurl_errors && response.unfurl_errors.length > 0;
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response) => ({
          unfurl_errors: response.unfurl_errors,
        }),
      },
      {
        name: 'attachment_failures',
        condition: (response) => {
          return response.files_upload_failed && response.files_upload_failed.length > 0;
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response) => ({
          files_failed: response.files_upload_failed,
        }),
      },
    ],
  },

  // =========================================================================
  // JIRA
  // =========================================================================
  JIRA_CREATE_JIRA_ISSUE: {
    checks: [
      {
        name: 'field_validation_warnings',
        condition: (response) => {
          return response.warnings && Object.keys(response.warnings).length > 0;
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response) => ({
          field_warnings: response.warnings,
        }),
      },
      {
        name: 'attachment_failures',
        condition: (response) => {
          return response.failedAttachments && response.failedAttachments.length > 0;
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response) => ({
          attachments_failed: response.failedAttachments,
        }),
      },
    ],
  },

  JIRA_UPDATE_JIRA_ISSUE: {
    checks: [
      {
        name: 'field_update_errors',
        condition: (response) => {
          const errors = response.errorCollection?.errors ||
                        response.errors ||
                        response.fieldErrors;
          return errors && Object.keys(errors).length > 0;
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response, params) => {
          const errors = response.errorCollection?.errors ||
                        response.errors ||
                        response.fieldErrors || {};
          const attemptedFields = params.fields ? Object.keys(params.fields) : [];
          const failedFields = Object.keys(errors);
          return {
            total: attemptedFields.length,
            succeeded: attemptedFields.filter(f => !failedFields.includes(f)),
            failed: failedFields.map(field => ({
              field,
              reason: errors[field],
            })),
          };
        },
      },
      {
        name: 'transition_warnings',
        condition: (response) => {
          return response.transitionWarnings && response.transitionWarnings.length > 0;
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response) => ({
          transition_warnings: response.transitionWarnings,
        }),
      },
    ],
  },

  JIRA_ADD_COMMENT: {
    checks: [
      {
        name: 'mention_failures',
        condition: (response) => {
          return response.failedMentions && response.failedMentions.length > 0;
        },
        sub_status: SUB_STATUS.PARTIAL_UPDATE,
        extract: (response) => ({
          failed_mentions: response.failedMentions,
        }),
      },
    ],
  },
};

// =============================================================================
// PARTIAL SUCCESS DETECTOR CLASS
// =============================================================================

class PartialSuccessDetector {
  constructor(customIndicators = {}) {
    this.indicators = { ...PARTIAL_SUCCESS_INDICATORS, ...customIndicators };
  }

  /**
   * Detect if a response represents partial success
   * @param {string} actionName - The action that was executed
   * @param {object} response - The raw response from the provider
   * @param {object} params - The parameters used for the action
   * @returns {object} - { isPartial, sub_status, details, checks_triggered }
   */
  detect(actionName, response, params = {}) {
    const result = {
      isPartial: false,
      sub_status: null,
      details: null,
      checks_triggered: [],
    };

    // Get indicators for this action
    const actionIndicators = this.indicators[actionName];
    if (!actionIndicators || !actionIndicators.checks) {
      return result;
    }

    // Run all checks
    for (const check of actionIndicators.checks) {
      try {
        if (check.condition(response, params)) {
          result.isPartial = true;
          result.sub_status = result.sub_status || check.sub_status;
          result.checks_triggered.push(check.name);

          // Extract details
          const checkDetails = check.extract(response, params);
          if (!result.details) {
            result.details = checkDetails;
          } else {
            // Merge details from multiple checks
            result.details = { ...result.details, ...checkDetails };
          }
        }
      } catch (error) {
        // Log but don't fail - partial success detection shouldn't break the flow
        console.warn(`Partial success check "${check.name}" failed for ${actionName}:`, error.message);
      }
    }

    return result;
  }

  /**
   * Register custom indicators for an action
   */
  registerIndicators(actionName, checks) {
    if (!this.indicators[actionName]) {
      this.indicators[actionName] = { checks: [] };
    }
    this.indicators[actionName].checks.push(...checks);
  }

  /**
   * Check if we have indicators for an action
   */
  hasIndicators(actionName) {
    return !!this.indicators[actionName];
  }

  /**
   * Get list of actions with partial success detection
   */
  getSupportedActions() {
    return Object.keys(this.indicators);
  }
}

// =============================================================================
// RESPONSE QUALITY ANALYZER
// =============================================================================

/**
 * Analyze response quality and completeness
 * Useful for determining if a "success" response is truly complete
 */
function analyzeResponseQuality(actionName, response, params = {}) {
  const quality = {
    score: 1.0, // 1.0 = perfect, 0.0 = completely failed
    issues: [],
    warnings: [],
  };

  if (!response) {
    quality.score = 0;
    quality.issues.push('No response received');
    return quality;
  }

  // Check for common warning indicators
  if (response.warning || response.warnings) {
    quality.score -= 0.1;
    quality.warnings.push('Response contains warnings');
  }

  // Check for partial data
  if (response.partial || response.isPartial) {
    quality.score -= 0.3;
    quality.issues.push('Response marked as partial');
  }

  // Check for expected data based on action type
  const action = actionName.toUpperCase();

  if (action.includes('CREATE')) {
    // Created items should have an ID
    const hasId = response.id || response.eventId || response.key ||
                  response.data?.id || response.data?.eventId;
    if (!hasId) {
      quality.score -= 0.5;
      quality.issues.push('Created resource has no ID');
    }
  }

  if (action.includes('LIST') || action.includes('FETCH') || action.includes('FIND')) {
    // List operations should return an array
    const items = response.items || response.events || response.messages ||
                  response.issues || response.data?.items || response.data;
    if (!Array.isArray(items) && items !== undefined) {
      quality.score -= 0.2;
      quality.warnings.push('List response is not an array');
    }
  }

  if (action.includes('SEND') || action.includes('EMAIL')) {
    // Check recipient count matches
    const to = params.to || params.recipients || [];
    const toCount = Array.isArray(to) ? to.length : (to ? 1 : 0);
    const failed = response.failedRecipients || response.failed_recipients || [];
    const failedCount = Array.isArray(failed) ? failed.length : 0;

    if (failedCount > 0) {
      const failRate = failedCount / toCount;
      quality.score -= failRate * 0.5;
      quality.issues.push(`${failedCount}/${toCount} recipients failed`);
    }
  }

  // Ensure score stays in bounds
  quality.score = Math.max(0, Math.min(1, quality.score));

  return quality;
}

// =============================================================================
// BATCH OPERATION ANALYZER
// =============================================================================

/**
 * Analyze batch operation results for partial success
 */
function analyzeBatchResults(results) {
  if (!Array.isArray(results)) {
    return {
      isPartial: false,
      total: 1,
      succeeded: results?.success ? 1 : 0,
      failed: results?.success ? 0 : 1,
      details: null,
    };
  }

  const succeeded = results.filter(r => r.success || r.successful || r.ok);
  const failed = results.filter(r => !r.success && !r.successful && !r.ok);

  return {
    isPartial: succeeded.length > 0 && failed.length > 0,
    total: results.length,
    succeeded: succeeded.length,
    failed: failed.length,
    details: {
      successful_items: succeeded.map(r => r.id || r.key || r.index),
      failed_items: failed.map(r => ({
        id: r.id || r.key || r.index,
        error: r.error || r.message || 'Unknown error',
      })),
    },
  };
}

// =============================================================================
// STANDALONE DETECTOR INSTANCE & FUNCTION
// =============================================================================

// Create a singleton instance for convenience
const defaultDetector = new PartialSuccessDetector();

/**
 * Detect partial success using the default detector instance
 * This is the main function that should be used by activities
 * @param {string} actionName - The action that was executed
 * @param {object} response - The raw response from the provider
 * @param {object} params - The parameters used for the action
 * @returns {object|null} - Partial success info or null if not partial
 */
function detectPartialSuccess(actionName, response, params = {}) {
  if (!response) return null;

  try {
    const result = defaultDetector.detect(actionName, response, params);
    return result.isPartial ? result : null;
  } catch (error) {
    console.warn(`[PartialSuccessDetector] Error detecting partial success for ${actionName}:`, error.message);
    return null;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  PartialSuccessDetector,
  PARTIAL_SUCCESS_INDICATORS,
  analyzeResponseQuality,
  analyzeBatchResults,
  detectPartialSuccess,
};
