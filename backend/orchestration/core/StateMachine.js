/**
 * StateMachine - Production-grade state management for task orchestration
 *
 * States:
 * - INITIAL: Request received, not yet processed
 * - PARSED: Tasks extracted from user message
 * - VALIDATED: All schemas validated, dependencies resolved
 * - COLLECTING: Collecting missing required fields from user
 * - READY: All required data collected, ready for execution
 * - EXECUTING: Tasks are being executed
 * - COMPLETED: All tasks completed successfully
 * - PARTIAL_SUCCESS: Some tasks succeeded, some failed
 * - FAILED: All tasks failed or critical error occurred
 *
 * Transitions are validated and logged.
 */

const { v4: uuidv4 } = require('uuid');

// Valid state transitions
const VALID_TRANSITIONS = {
  INITIAL: ['PARSED', 'FAILED'],
  PARSED: ['VALIDATED', 'COMPLETED', 'FAILED'], // COMPLETED allowed for chat-only responses
  VALIDATED: ['COLLECTING', 'READY', 'FAILED'],
  COLLECTING: ['COLLECTING', 'READY', 'FAILED'],
  READY: ['EXECUTING', 'FAILED'],
  EXECUTING: ['COMPLETED', 'PARTIAL_SUCCESS', 'FAILED'],
  COMPLETED: [], // Terminal state
  PARTIAL_SUCCESS: [], // Terminal state
  FAILED: [], // Terminal state
};

const TERMINAL_STATES = ['COMPLETED', 'PARTIAL_SUCCESS', 'FAILED'];

class StateMachine {
  constructor(requestId = null) {
    this.requestId = requestId || uuidv4();
    this.state = 'INITIAL';
    this.history = [];
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.data = {
      originalMessage: null,
      parsedTasks: [],
      validatedTasks: [],
      collectedFields: {},
      executionResults: [],
      error: null,
      metadata: {},
    };

    // Log initial state
    this._recordTransition(null, 'INITIAL', 'State machine initialized');
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if in terminal state
   */
  isTerminal() {
    return TERMINAL_STATES.includes(this.state);
  }

  /**
   * Transition to a new state
   * @throws Error if transition is invalid
   */
  transition(newState, reason = '') {
    const validNext = VALID_TRANSITIONS[this.state] || [];

    if (!validNext.includes(newState)) {
      const error = new Error(
        `Invalid state transition: ${this.state} -> ${newState}. ` +
        `Valid transitions from ${this.state}: [${validNext.join(', ')}]`
      );
      error.code = 'INVALID_STATE_TRANSITION';
      error.currentState = this.state;
      error.attemptedState = newState;
      throw error;
    }

    const previousState = this.state;
    this.state = newState;
    this.updatedAt = new Date();

    this._recordTransition(previousState, newState, reason);

    console.log(`[StateMachine:${this.requestId}] ${previousState} -> ${newState}${reason ? `: ${reason}` : ''}`);

    return this;
  }

  /**
   * Attempt transition - returns false instead of throwing
   */
  tryTransition(newState, reason = '') {
    try {
      this.transition(newState, reason);
      return true;
    } catch (error) {
      console.warn(`[StateMachine:${this.requestId}] Failed transition: ${error.message}`);
      return false;
    }
  }

  /**
   * Set data on the state machine
   */
  setData(key, value) {
    this.data[key] = value;
    this.updatedAt = new Date();
    return this;
  }

  /**
   * Get data from the state machine
   */
  getData(key) {
    return key ? this.data[key] : this.data;
  }

  /**
   * Add metadata
   */
  addMetadata(key, value) {
    this.data.metadata[key] = value;
    this.updatedAt = new Date();
    return this;
  }

  /**
   * Record a transition in history
   */
  _recordTransition(from, to, reason) {
    this.history.push({
      from,
      to,
      reason,
      timestamp: new Date(),
    });
  }

  /**
   * Get state history
   */
  getHistory() {
    return this.history;
  }

  /**
   * Serialize state machine for persistence
   */
  serialize() {
    return {
      requestId: this.requestId,
      state: this.state,
      history: this.history,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      data: this.data,
    };
  }

  /**
   * Deserialize state machine from persistence
   */
  static deserialize(json) {
    const sm = new StateMachine(json.requestId);
    sm.state = json.state;
    sm.history = json.history;
    sm.createdAt = new Date(json.createdAt);
    sm.updatedAt = new Date(json.updatedAt);
    sm.data = json.data;
    return sm;
  }

  /**
   * Create a snapshot for debugging
   */
  snapshot() {
    return {
      requestId: this.requestId,
      state: this.state,
      isTerminal: this.isTerminal(),
      age: Date.now() - this.createdAt.getTime(),
      transitionCount: this.history.length,
      lastTransition: this.history[this.history.length - 1],
    };
  }
}

module.exports = { StateMachine, VALID_TRANSITIONS, TERMINAL_STATES };
