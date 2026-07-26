/**
 * SideEffectGateway - Phase Enforcement and Parameter Sanitization
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                    SIDE EFFECT GATEWAY                              │
 * │                                                                     │
 * │  Request ──→ ┌──────────────┐                                      │
 * │              │ Phase Check  │                                      │
 * │              └──────┬───────┘                                      │
 * │                     ↓                                               │
 * │              ┌──────────────┐                                      │
 * │              │  Tier Check  │──→ Tier > allowed? → BLOCK           │
 * │              └──────┬───────┘                                      │
 * │                     ↓                                               │
 * │              ┌──────────────┐                                      │
 * │              │  Sanitize    │──→ Apply forced_params for phase     │
 * │              │  Params      │                                      │
 * │              └──────┬───────┘                                      │
 * │                     ↓                                               │
 * │              ┌──────────────┐                                      │
 * │              │ Audit Log    │──→ Record action attempt             │
 * │              └──────┬───────┘                                      │
 * │                     ↓                                               │
 * │              ┌──────────────┐                                      │
 * │              │  ALLOW       │──→ Return sanitized params           │
 * │              └──────────────┘                                      │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Side Effect Tiers:
 * - Tier 0 (PURE_READ): No side effects, safe for any phase
 * - Tier 1 (IMPLICIT_WRITE): Hidden side effects (read receipts, logs)
 * - Tier 2 (EXPLICIT_WRITE): Obvious mutations (create, update, delete)
 *
 * Execution Phases:
 * - PREFLIGHT: Only tier 0 allowed, used for gathering info before user confirms
 * - VALIDATION: Tier 0-1 allowed with sanitization, validating user's request
 * - EXECUTION: All tiers allowed, user has confirmed the action
 * - POST_EXECUTION: Cleanup only, logging and state updates
 */

const { ACTION_ALLOWLIST } = require('./ActionRegistry');

// Re-export constants for external use
const SIDE_EFFECT_TIERS = {
  PURE_READ: 0,
  IMPLICIT_WRITE: 1,
  EXPLICIT_WRITE: 2,
};

const EXECUTION_PHASES = {
  PREFLIGHT: 'preflight',
  VALIDATION: 'validation',
  EXECUTION: 'execution',
  POST_EXECUTION: 'post_exec',
};

// Phase to maximum allowed tier mapping
const PHASE_MAX_TIER = {
  [EXECUTION_PHASES.PREFLIGHT]: SIDE_EFFECT_TIERS.PURE_READ,      // Only tier 0
  [EXECUTION_PHASES.VALIDATION]: SIDE_EFFECT_TIERS.IMPLICIT_WRITE, // Tier 0-1
  [EXECUTION_PHASES.EXECUTION]: SIDE_EFFECT_TIERS.EXPLICIT_WRITE,  // All tiers
  [EXECUTION_PHASES.POST_EXECUTION]: SIDE_EFFECT_TIERS.PURE_READ,  // Only tier 0 (logging)
};

class SideEffectGateway {
  constructor(options = {}) {
    this.auditLog = [];
    this.maxAuditEntries = options.maxAuditEntries || 1000;
    this.onBlock = options.onBlock || null; // Callback when action is blocked
    this.onSanitize = options.onSanitize || null; // Callback when params are sanitized
  }

  /**
   * Check if an action is allowed in the given phase
   * @param {string} actionName - The action to check
   * @param {string} phase - Current execution phase
   * @param {Object} params - Action parameters
   * @returns {Object} { allowed, reason, sanitizedParams, alternative }
   */
  check(actionName, phase, params = {}) {
    const actionMeta = ACTION_ALLOWLIST.actions[actionName];

    // Unknown action - let ActionRegistry handle this
    if (!actionMeta) {
      return {
        allowed: true, // Pass through, ActionRegistry will reject if invalid
        reason: null,
        sanitizedParams: params,
        alternative: null,
      };
    }

    const actionTier = actionMeta.side_effect_tier ?? SIDE_EFFECT_TIERS.EXPLICIT_WRITE;
    const maxAllowedTier = PHASE_MAX_TIER[phase] ?? SIDE_EFFECT_TIERS.EXPLICIT_WRITE;

    // Log the check
    this._audit('check', {
      action: actionName,
      phase,
      actionTier,
      maxAllowedTier,
      params: this._sanitizeParamsForLog(params),
    });

    // Check if tier is allowed for this phase
    if (actionTier > maxAllowedTier) {
      const blockResult = this._handleBlock(actionName, actionMeta, phase, params);
      return blockResult;
    }

    // Action tier is allowed, but may need parameter sanitization
    const sanitizedParams = this._sanitizeParams(actionName, actionMeta, phase, params);

    return {
      allowed: true,
      reason: null,
      sanitizedParams,
      alternative: null,
      tier: actionTier,
      phase,
      sideEffects: actionMeta.side_effects || [],
    };
  }

  /**
   * Handle a blocked action - suggest alternatives if available
   */
  _handleBlock(actionName, actionMeta, phase, params) {
    const tierName = this._getTierName(actionMeta.side_effect_tier);
    const phaseName = phase;

    // Log the block
    this._audit('block', {
      action: actionName,
      phase,
      tier: actionMeta.side_effect_tier,
      reason: `${tierName} action not allowed in ${phaseName} phase`,
    });

    // Callback if provided
    if (this.onBlock) {
      this.onBlock({ action: actionName, phase, tier: actionMeta.side_effect_tier });
    }

    // Check for preflight alternative
    const alternative = actionMeta.preflight_alternative;
    if (alternative && phase === EXECUTION_PHASES.PREFLIGHT) {
      return {
        allowed: false,
        reason: `Action '${actionMeta.user_facing_name}' has side effects (${tierName}) and cannot run during ${phaseName}`,
        sanitizedParams: null,
        alternative: {
          action: alternative.action,
          description: alternative.description,
          forcedParams: alternative.forced_params || {},
          suggestion: `Use '${alternative.action}' instead, or wait until execution phase`,
        },
        tier: actionMeta.side_effect_tier,
        phase,
        sideEffects: actionMeta.side_effects || [],
      };
    }

    return {
      allowed: false,
      reason: `Action '${actionMeta.user_facing_name}' has side effects (${tierName}) and cannot run during ${phaseName} phase`,
      sanitizedParams: null,
      alternative: phase === EXECUTION_PHASES.PREFLIGHT
        ? { suggestion: 'Wait until user confirms, then execute in EXECUTION phase' }
        : null,
      tier: actionMeta.side_effect_tier,
      phase,
      sideEffects: actionMeta.side_effects || [],
    };
  }

  /**
   * Sanitize parameters based on phase and action rules
   */
  _sanitizeParams(actionName, actionMeta, phase, params) {
    // No sanitization rules defined
    if (!actionMeta.sanitization_rules) {
      return params;
    }

    const phaseRules = actionMeta.sanitization_rules[phase];
    if (!phaseRules) {
      return params;
    }

    // Apply sanitization rules
    const sanitized = { ...params };
    let wasModified = false;

    for (const [key, forcedValue] of Object.entries(phaseRules)) {
      if (sanitized[key] !== forcedValue) {
        console.log(`[SideEffectGateway] Sanitizing ${actionName}.${key}: ${sanitized[key]} → ${forcedValue} (${phase} phase)`);
        sanitized[key] = forcedValue;
        wasModified = true;
      }
    }

    if (wasModified) {
      this._audit('sanitize', {
        action: actionName,
        phase,
        original: this._sanitizeParamsForLog(params),
        sanitized: this._sanitizeParamsForLog(sanitized),
        rules: phaseRules,
      });

      if (this.onSanitize) {
        this.onSanitize({ action: actionName, phase, original: params, sanitized });
      }
    }

    return sanitized;
  }

  /**
   * Check if an action requires user confirmation
   */
  requiresConfirmation(actionName) {
    const actionMeta = ACTION_ALLOWLIST.actions[actionName];
    if (!actionMeta) return false;

    return actionMeta.requires_confirmation === true ||
           actionMeta.irreversible === true ||
           actionMeta.side_effect_tier === SIDE_EFFECT_TIERS.EXPLICIT_WRITE;
  }

  /**
   * Get detailed side effect information for an action
   */
  getSideEffectInfo(actionName) {
    const actionMeta = ACTION_ALLOWLIST.actions[actionName];
    if (!actionMeta) {
      return null;
    }

    return {
      action: actionName,
      tier: actionMeta.side_effect_tier ?? SIDE_EFFECT_TIERS.EXPLICIT_WRITE,
      tierName: this._getTierName(actionMeta.side_effect_tier),
      sideEffects: actionMeta.side_effects || [],
      preflight_safe: actionMeta.preflight_safe ?? false,
      preflight_alternative: actionMeta.preflight_alternative || null,
      requires_confirmation: this.requiresConfirmation(actionName),
      mutating: actionMeta.mutating ?? true,
      irreversible: actionMeta.irreversible ?? false,
    };
  }

  /**
   * Get all actions safe for a given phase
   */
  getActionsForPhase(phase) {
    const maxTier = PHASE_MAX_TIER[phase] ?? SIDE_EFFECT_TIERS.PURE_READ;
    const actions = [];

    for (const [name, meta] of Object.entries(ACTION_ALLOWLIST.actions)) {
      if (!meta.enabled) continue;

      const tier = meta.side_effect_tier ?? SIDE_EFFECT_TIERS.EXPLICIT_WRITE;
      if (tier <= maxTier) {
        actions.push({
          action: name,
          tier,
          tierName: this._getTierName(tier),
          user_facing_name: meta.user_facing_name,
        });
      }
    }

    return actions;
  }

  /**
   * Get a summary of side effects for a list of actions
   * Useful for showing user what will happen before execution
   */
  summarizeSideEffects(actionNames) {
    const summary = {
      actions: [],
      totalSideEffects: [],
      requiresConfirmation: false,
      hasIrreversible: false,
      highestTier: 0,
    };

    for (const actionName of actionNames) {
      const info = this.getSideEffectInfo(actionName);
      if (!info) continue;

      summary.actions.push({
        action: actionName,
        tierName: info.tierName,
        sideEffects: info.sideEffects,
        irreversible: info.irreversible,
      });

      summary.totalSideEffects.push(...info.sideEffects);
      summary.highestTier = Math.max(summary.highestTier, info.tier);

      if (info.requires_confirmation) {
        summary.requiresConfirmation = true;
      }
      if (info.irreversible) {
        summary.hasIrreversible = true;
      }
    }

    // Deduplicate side effects by type
    const uniqueEffects = new Map();
    for (const effect of summary.totalSideEffects) {
      if (!uniqueEffects.has(effect.type)) {
        uniqueEffects.set(effect.type, effect);
      }
    }
    summary.totalSideEffects = Array.from(uniqueEffects.values());

    return summary;
  }

  /**
   * Generate a user-friendly warning message for an action
   */
  generateWarning(actionName) {
    const info = this.getSideEffectInfo(actionName);
    if (!info) return null;

    if (info.tier === SIDE_EFFECT_TIERS.PURE_READ) {
      return null; // No warning needed
    }

    const warnings = [];

    if (info.irreversible) {
      warnings.push('⚠️ This action cannot be undone');
    }

    if (info.sideEffects.length > 0) {
      warnings.push('This action will:');
      for (const effect of info.sideEffects) {
        warnings.push(`  • ${effect.description}`);
      }
    }

    if (info.requires_confirmation) {
      warnings.push('Please confirm before proceeding.');
    }

    return warnings.length > 0 ? warnings.join('\n') : null;
  }

  /**
   * Add entry to audit log
   */
  _audit(type, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      type,
      ...data,
    };

    this.auditLog.push(entry);

    // Trim if exceeds max
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-this.maxAuditEntries);
    }

    // Also log to console for debugging
    console.log(`[SideEffectGateway] ${type}:`, JSON.stringify(data));
  }

  /**
   * Get audit log entries
   */
  getAuditLog(filter = {}) {
    let entries = [...this.auditLog];

    if (filter.type) {
      entries = entries.filter(e => e.type === filter.type);
    }
    if (filter.action) {
      entries = entries.filter(e => e.action === filter.action);
    }
    if (filter.phase) {
      entries = entries.filter(e => e.phase === filter.phase);
    }
    if (filter.since) {
      const sinceDate = new Date(filter.since);
      entries = entries.filter(e => new Date(e.timestamp) >= sinceDate);
    }

    return entries;
  }

  /**
   * Clear audit log
   */
  clearAuditLog() {
    this.auditLog = [];
  }

  /**
   * Get tier name for display
   */
  _getTierName(tier) {
    switch (tier) {
      case SIDE_EFFECT_TIERS.PURE_READ:
        return 'PURE_READ';
      case SIDE_EFFECT_TIERS.IMPLICIT_WRITE:
        return 'IMPLICIT_WRITE';
      case SIDE_EFFECT_TIERS.EXPLICIT_WRITE:
        return 'EXPLICIT_WRITE';
      default:
        return 'UNKNOWN';
    }
  }

  /**
   * Sanitize params for logging (remove sensitive data)
   */
  _sanitizeParamsForLog(params) {
    if (!params) return params;

    const sanitized = { ...params };
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'credential'];

    for (const field of sensitiveFields) {
      for (const key of Object.keys(sanitized)) {
        if (key.toLowerCase().includes(field)) {
          sanitized[key] = '[REDACTED]';
        }
      }
    }

    return sanitized;
  }
}

// Singleton instance for convenience
const defaultGateway = new SideEffectGateway();

module.exports = {
  SideEffectGateway,
  SIDE_EFFECT_TIERS,
  EXECUTION_PHASES,
  PHASE_MAX_TIER,
  defaultGateway,
};
