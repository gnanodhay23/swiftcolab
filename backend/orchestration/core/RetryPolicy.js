/**
 * RetryPolicy - Production-grade retry logic with exponential backoff
 *
 * Features:
 * - Exponential backoff with jitter
 * - Configurable max retries
 * - Retryable vs non-retryable error classification
 * - Circuit breaker pattern support
 * - Detailed retry logging
 */

// Error codes that should trigger a retry
const RETRYABLE_ERRORS = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  'RATE_LIMIT',
  'SERVICE_UNAVAILABLE',
  'GATEWAY_TIMEOUT',
  'TOO_MANY_REQUESTS',
]);

// HTTP status codes that should trigger a retry
const RETRYABLE_STATUS_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

// Error codes that should NOT be retried
const NON_RETRYABLE_ERRORS = new Set([
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'BAD_REQUEST',
]);

class RetryPolicy {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
    this.jitterFactor = options.jitterFactor ?? 0.1;
    this.backoffMultiplier = options.backoffMultiplier ?? 2;
  }

  /**
   * Execute a function with retry logic
   * @param {Function} fn - Async function to execute
   * @param {Object} context - Context for logging (action name, request id, etc.)
   * @returns {Promise<any>} Result of the function
   */
  async execute(fn, context = {}) {
    const { action = 'unknown', requestId = 'N/A' } = context;
    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await fn();

        if (attempt > 0) {
          console.log(
            `[RetryPolicy:${requestId}] ${action} succeeded after ${attempt} retries`
          );
        }

        return result;
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryable(error)) {
          console.log(
            `[RetryPolicy:${requestId}] ${action} failed with non-retryable error: ${error.message}`
          );
          throw error;
        }

        // Check if we've exhausted retries
        if (attempt >= this.maxRetries) {
          console.log(
            `[RetryPolicy:${requestId}] ${action} failed after ${this.maxRetries} retries: ${error.message}`
          );
          throw error;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt);

        console.log(
          `[RetryPolicy:${requestId}] ${action} attempt ${attempt + 1} failed: ${error.message}. ` +
          `Retrying in ${delay}ms (${this.maxRetries - attempt} retries remaining)`
        );

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Determine if an error is retryable
   */
  isRetryable(error) {
    // Check explicit non-retryable codes
    if (error.code && NON_RETRYABLE_ERRORS.has(error.code)) {
      return false;
    }

    // Check explicit retryable codes
    if (error.code && RETRYABLE_ERRORS.has(error.code)) {
      return true;
    }

    // Check HTTP status codes
    const statusCode = error.status || error.statusCode || error.response?.status;
    if (statusCode && RETRYABLE_STATUS_CODES.has(statusCode)) {
      return true;
    }

    // Check for rate limiting
    if (error.message?.toLowerCase().includes('rate limit')) {
      return true;
    }

    // Check for timeout
    if (error.message?.toLowerCase().includes('timeout')) {
      return true;
    }

    // Check for network errors
    if (error.message?.toLowerCase().includes('network')) {
      return true;
    }

    // Check for service unavailable
    if (error.message?.toLowerCase().includes('unavailable')) {
      return true;
    }

    // Default: check status code ranges
    if (statusCode >= 500 && statusCode < 600) {
      return true;
    }

    // 4xx errors (except 408, 429) are typically not retryable
    if (statusCode >= 400 && statusCode < 500) {
      return false;
    }

    // Default to not retryable for unknown errors
    return false;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  calculateDelay(attempt) {
    // Exponential backoff: baseDelay * (multiplier ^ attempt)
    const exponentialDelay = this.baseDelayMs * Math.pow(this.backoffMultiplier, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);

    // Add jitter (random variation to prevent thundering herd)
    const jitter = cappedDelay * this.jitterFactor * (Math.random() * 2 - 1);

    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a policy optimized for Composio API calls
   */
  static forComposio() {
    return new RetryPolicy({
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 15000,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
    });
  }

  /**
   * Create a policy for LLM calls (longer delays, fewer retries)
   */
  static forLLM() {
    return new RetryPolicy({
      maxRetries: 2,
      baseDelayMs: 2000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      jitterFactor: 0.15,
    });
  }

  /**
   * Create a policy for quick operations (more retries, shorter delays)
   */
  static forQuickOps() {
    return new RetryPolicy({
      maxRetries: 5,
      baseDelayMs: 200,
      maxDelayMs: 2000,
      backoffMultiplier: 1.5,
      jitterFactor: 0.2,
    });
  }
}

module.exports = { RetryPolicy, RETRYABLE_ERRORS, NON_RETRYABLE_ERRORS, RETRYABLE_STATUS_CODES };
