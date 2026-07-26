/**
 * Core Orchestration Components
 *
 * This module exports all core components for the intelligent orchestration system:
 *
 * Existing Production Components:
 * - StateMachine: State management for task execution
 * - RetryPolicy: Resilient API calls with retry logic
 * - ErrorHandler: User-friendly error messages
 * - TaskGraph: Dependency management
 * - IdempotencyManager: Duplicate prevention
 *
 * Context-Aware Components:
 * - ContextMemoryCache: Intelligent context caching for slot filling
 * - ToolRouter: Intent to tool mapping with timezone-aware date handling
 * - ActionResultFormatter: Human-readable result formatting
 * - SchemaValidator: JSON Schema validation with Ajv
 * - EnhancedSlotFiller: Context-aware slot filling wrapper
 *
 * NEW Fix Components (v2):
 * - JQLBuilder: Intelligent JQL construction with negation detection
 * - WorkflowGates: Stop workflows on empty upstream data
 * - EmailBodyGenerator: Dynamic email body from data
 * - ParameterIsolator: Prevent parameter contamination between actions
 * - PreviousReferenceResolver: Resolve "same/previous/last" references
 * - DataReferenceResolver: Resolve "those tickets" / "send those" references
 */

// Existing production components
const { StateMachine } = require('./StateMachine');
const { RetryPolicy } = require('./RetryPolicy');
const { ErrorHandler } = require('./ErrorHandler');
const { TaskGraph } = require('./TaskGraph');

// Context-aware components
const { ContextMemoryCache } = require('./ContextMemoryCache');
// ToolRouter moved to orchestration/ToolRouter.js (unified version with dynamic Composio schemas)
const ToolRouter = require('../ToolRouter');
// Date utilities extracted to DateUtils.js
const { INTENT_PATTERNS, INTENT_ACTION_MAP, getDateString, getTodayRange, getWeekRange, getTomorrowRange, parseNaturalDateTime, addDurationToTime } = require('./DateUtils');
const { ActionResultFormatter } = require('./ActionResultFormatter');
const { SchemaValidator } = require('./SchemaValidator');
// EnhancedSlotFiller deleted - use UnifiedSlotFiller from unified/ instead
const UnifiedSlotFiller = require('../unified/UnifiedSlotFiller');

// NEW Fix Components (v2)
const { JQLBuilder, buildJQL, validateJQL, ASSIGNEE_NEGATION_PATTERNS } = require('./JQLBuilder');
const { WorkflowGates, evaluateGate, isDataProducer, isDataConsumer, countResultItems } = require('./WorkflowGates');
const { EmailBodyGenerator, generateEmailBody, validateEmailParams } = require('./EmailBodyGenerator');
const { ParameterIsolator, isolateParams, splitParams, validateParams, ACTION_PARAMS } = require('./ParameterIsolator');
const { PreviousReferenceResolver, REFERENCE_PATTERNS, ACTION_PARAM_MAP } = require('./PreviousReferenceResolver');
const { DataReferenceResolver, DATA_REFERENCE_PATTERNS } = require('./DataReferenceResolver');

// Dynamic Question Generation (no hardcoded questions)
const {
  DynamicQuestionGenerator,
  questionGenerator,
  generateQuestion,
  generateAllQuestions,
  formatEnumOptions,
  generateQuestionObject,
  generateTaskQuestions,
} = require('./DynamicQuestionGenerator');

// Task Validation Orchestrator - coordinates validation of ALL tasks
const {
  TaskValidationOrchestrator,
  AUTO_FILL_PATTERNS,
  NEVER_AUTO_FILL,
  CAN_AUTO_FILL,
} = require('./TaskValidationOrchestrator');

module.exports = {
  // Existing production components
  StateMachine,
  RetryPolicy,
  ErrorHandler,
  TaskGraph,

  // Context-aware components
  ContextMemoryCache,
  ToolRouter,
  ActionResultFormatter,
  SchemaValidator,
  UnifiedSlotFiller,

  // Intent patterns and mappings
  INTENT_PATTERNS,
  INTENT_ACTION_MAP,

  // Date/time utilities
  getDateString,
  getTodayRange,
  getWeekRange,
  getTomorrowRange,
  parseNaturalDateTime,
  addDurationToTime,

  // NEW Fix Components (v2)
  JQLBuilder,
  buildJQL,
  validateJQL,
  ASSIGNEE_NEGATION_PATTERNS,

  WorkflowGates,
  evaluateGate,
  isDataProducer,
  isDataConsumer,
  countResultItems,

  EmailBodyGenerator,
  generateEmailBody,
  validateEmailParams,

  ParameterIsolator,
  isolateParams,
  splitParams,
  validateParams,
  ACTION_PARAMS,

  PreviousReferenceResolver,
  REFERENCE_PATTERNS,
  ACTION_PARAM_MAP,

  DataReferenceResolver,
  DATA_REFERENCE_PATTERNS,

  // Dynamic Question Generation
  DynamicQuestionGenerator,
  questionGenerator,
  generateQuestion,
  generateAllQuestions,
  formatEnumOptions,
  generateQuestionObject,
  generateTaskQuestions,

  // Task Validation Orchestrator
  TaskValidationOrchestrator,
  AUTO_FILL_PATTERNS,
  NEVER_AUTO_FILL,
  CAN_AUTO_FILL,
};
