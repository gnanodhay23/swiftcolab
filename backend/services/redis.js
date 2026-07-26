/**
 * Redis Service - Centralized Redis client with caching utilities
 *
 * Features:
 * - Connection management with auto-reconnect
 * - Caching with TTL support
 * - Session storage
 * - Rate limiting
 * - Pub/Sub support
 * - Graceful degradation when Redis unavailable
 */

const Redis = require('ioredis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Redis connection state
let redis = null;
let isConnected = false;
let connectionError = null;

// Cache TTL defaults (in seconds)
const TTL = {
  SHORT: 60,           // 1 minute
  MEDIUM: 300,         // 5 minutes
  LONG: 3600,          // 1 hour
  SESSION: 86400,      // 24 hours
  SCHEMA: 86400,       // 24 hours (tool schemas don't change often)
  RATE_LIMIT: 60,      // 1 minute window
};

// Key prefixes for organization
const PREFIX = {
  CACHE: 'cache:',
  SESSION: 'session:',
  RATE: 'rate:',
  PENDING: 'pending:',
  SCHEMA: 'schema:',
  LOCK: 'lock:',
};

/**
 * Initialize Redis connection
 */
function initRedis() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    console.log('[Redis] No REDIS_URL configured, running without Redis');
    return null;
  }

  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: false,
      showFriendlyErrorStack: process.env.NODE_ENV !== 'production',
      // Reconnect strategy
      retryStrategy(times) {
        if (times > 10) {
          console.error('[Redis] Max reconnection attempts reached');
          return null; // Stop retrying
        }
        const delay = Math.min(times * 100, 3000);
        console.log(`[Redis] Reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
      },
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected to Redis Cloud');
      isConnected = true;
      connectionError = null;
    });

    redis.on('ready', () => {
      console.log('[Redis] Ready to accept commands');
    });

    redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
      connectionError = err.message;
      isConnected = false;
    });

    redis.on('close', () => {
      console.log('[Redis] Connection closed');
      isConnected = false;
    });

    redis.on('reconnecting', () => {
      console.log('[Redis] Reconnecting...');
    });

    return redis;
  } catch (error) {
    console.error('[Redis] Failed to initialize:', error.message);
    connectionError = error.message;
    return null;
  }
}

/**
 * Get Redis client (with lazy initialization)
 */
function getClient() {
  if (!redis) {
    redis = initRedis();
  }
  return redis;
}

/**
 * Check if Redis is available
 */
function isAvailable() {
  return redis && isConnected;
}

/**
 * Get connection status
 */
function getStatus() {
  return {
    connected: isConnected,
    error: connectionError,
    url: process.env.REDIS_URL ? 'configured' : 'not configured',
  };
}

// ==========================================
// Caching Functions
// ==========================================

/**
 * Get cached value
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} Cached value or null
 */
async function get(key) {
  if (!isAvailable()) return null;

  try {
    const value = await redis.get(PREFIX.CACHE + key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error('[Redis] Get error:', error.message);
    return null;
  }
}

/**
 * Set cached value with TTL
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - TTL in seconds (default: 5 minutes)
 */
async function set(key, value, ttl = TTL.MEDIUM) {
  if (!isAvailable()) return false;

  try {
    await redis.setex(PREFIX.CACHE + key, ttl, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error('[Redis] Set error:', error.message);
    return false;
  }
}

/**
 * Delete cached value
 * @param {string} key - Cache key
 */
async function del(key) {
  if (!isAvailable()) return false;

  try {
    await redis.del(PREFIX.CACHE + key);
    return true;
  } catch (error) {
    console.error('[Redis] Delete error:', error.message);
    return false;
  }
}

/**
 * Get or set cached value (cache-aside pattern)
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Function to fetch value if not cached
 * @param {number} ttl - TTL in seconds
 */
async function getOrSet(key, fetchFn, ttl = TTL.MEDIUM) {
  // Try cache first
  const cached = await get(key);
  if (cached !== null) {
    return cached;
  }

  // Fetch and cache
  const value = await fetchFn();
  if (value !== null && value !== undefined) {
    await set(key, value, ttl);
  }
  return value;
}

/**
 * Clear all cache with optional pattern
 * @param {string} pattern - Key pattern (default: all cache)
 */
async function clearCache(pattern = '*') {
  if (!isAvailable()) return false;

  try {
    const keys = await redis.keys(PREFIX.CACHE + pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    return true;
  } catch (error) {
    console.error('[Redis] Clear cache error:', error.message);
    return false;
  }
}

// ==========================================
// Session Functions
// ==========================================

/**
 * Store session data
 * @param {string} sessionId - Session ID
 * @param {Object} data - Session data
 * @param {number} ttl - TTL in seconds (default: 24 hours)
 */
async function setSession(sessionId, data, ttl = TTL.SESSION) {
  if (!isAvailable()) return false;

  try {
    await redis.setex(
      PREFIX.SESSION + sessionId,
      ttl,
      JSON.stringify(data)
    );
    return true;
  } catch (error) {
    console.error('[Redis] Set session error:', error.message);
    return false;
  }
}

/**
 * Get session data
 * @param {string} sessionId - Session ID
 */
async function getSession(sessionId) {
  if (!isAvailable()) return null;

  try {
    const data = await redis.get(PREFIX.SESSION + sessionId);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('[Redis] Get session error:', error.message);
    return null;
  }
}

/**
 * Delete session
 * @param {string} sessionId - Session ID
 */
async function deleteSession(sessionId) {
  if (!isAvailable()) return false;

  try {
    await redis.del(PREFIX.SESSION + sessionId);
    return true;
  } catch (error) {
    console.error('[Redis] Delete session error:', error.message);
    return false;
  }
}

/**
 * Extend session TTL
 * @param {string} sessionId - Session ID
 * @param {number} ttl - New TTL in seconds
 */
async function extendSession(sessionId, ttl = TTL.SESSION) {
  if (!isAvailable()) return false;

  try {
    await redis.expire(PREFIX.SESSION + sessionId, ttl);
    return true;
  } catch (error) {
    console.error('[Redis] Extend session error:', error.message);
    return false;
  }
}

// ==========================================
// Rate Limiting Functions
// ==========================================

/**
 * Check and increment rate limit
 * @param {string} identifier - User/IP identifier
 * @param {number} limit - Max requests per window
 * @param {number} windowSeconds - Time window in seconds
 * @returns {Object} { allowed: boolean, remaining: number, resetIn: number }
 */
async function checkRateLimit(identifier, limit = 100, windowSeconds = TTL.RATE_LIMIT) {
  if (!isAvailable()) {
    // Graceful degradation: allow request if Redis is down
    return { allowed: true, remaining: limit, resetIn: 0 };
  }

  const key = PREFIX.RATE + identifier;

  try {
    const multi = redis.multi();
    multi.incr(key);
    multi.ttl(key);
    const results = await multi.exec();

    const count = results[0][1];
    let ttl = results[1][1];

    // Set TTL on first request
    if (ttl === -1) {
      await redis.expire(key, windowSeconds);
      ttl = windowSeconds;
    }

    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);

    return { allowed, remaining, resetIn: ttl };
  } catch (error) {
    console.error('[Redis] Rate limit error:', error.message);
    return { allowed: true, remaining: limit, resetIn: 0 };
  }
}

// ==========================================
// Pending Connection Functions
// ==========================================

/**
 * Store pending connection state (for OAuth flows)
 * @param {string} connectionId - Connection ID
 * @param {Object} data - Connection data
 * @param {number} ttl - TTL in seconds (default: 10 minutes)
 */
async function setPendingConnection(connectionId, data, ttl = 600) {
  if (!isAvailable()) return false;

  try {
    await redis.setex(
      PREFIX.PENDING + connectionId,
      ttl,
      JSON.stringify(data)
    );
    return true;
  } catch (error) {
    console.error('[Redis] Set pending connection error:', error.message);
    return false;
  }
}

/**
 * Get pending connection state
 * @param {string} connectionId - Connection ID
 */
async function getPendingConnection(connectionId) {
  if (!isAvailable()) return null;

  try {
    const data = await redis.get(PREFIX.PENDING + connectionId);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('[Redis] Get pending connection error:', error.message);
    return null;
  }
}

/**
 * Delete pending connection
 * @param {string} connectionId - Connection ID
 */
async function deletePendingConnection(connectionId) {
  if (!isAvailable()) return false;

  try {
    await redis.del(PREFIX.PENDING + connectionId);
    return true;
  } catch (error) {
    console.error('[Redis] Delete pending connection error:', error.message);
    return false;
  }
}

// ==========================================
// Schema Caching Functions
// ==========================================

/**
 * Cache tool schema
 * @param {string} actionName - Action name (e.g., GOOGLECALENDAR_CREATE_EVENT)
 * @param {Object} schema - Schema object
 */
async function cacheSchema(actionName, schema) {
  return set(PREFIX.SCHEMA + actionName, schema, TTL.SCHEMA);
}

/**
 * Get cached schema
 * @param {string} actionName - Action name
 */
async function getCachedSchema(actionName) {
  return get(PREFIX.SCHEMA + actionName);
}

// ==========================================
// Distributed Lock Functions
// ==========================================

/**
 * Acquire a distributed lock
 * @param {string} lockName - Lock name
 * @param {number} ttl - Lock TTL in seconds
 * @returns {Promise<string|null>} Lock token or null if failed
 */
async function acquireLock(lockName, ttl = 30) {
  if (!isAvailable()) return null;

  const token = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const key = PREFIX.LOCK + lockName;

  try {
    const result = await redis.set(key, token, 'EX', ttl, 'NX');
    return result === 'OK' ? token : null;
  } catch (error) {
    console.error('[Redis] Acquire lock error:', error.message);
    return null;
  }
}

/**
 * Release a distributed lock
 * @param {string} lockName - Lock name
 * @param {string} token - Lock token
 */
async function releaseLock(lockName, token) {
  if (!isAvailable()) return false;

  const key = PREFIX.LOCK + lockName;

  try {
    // Only release if we own the lock
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, 1, key, token);
    return true;
  } catch (error) {
    console.error('[Redis] Release lock error:', error.message);
    return false;
  }
}

// ==========================================
// Health Check
// ==========================================

/**
 * Ping Redis to check connection
 */
async function ping() {
  if (!redis) return false;

  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch (error) {
    console.error('[Redis] Ping error:', error.message);
    return false;
  }
}

/**
 * Get Redis info
 */
async function getInfo() {
  if (!isAvailable()) return null;

  try {
    const info = await redis.info('server');
    return info;
  } catch (error) {
    console.error('[Redis] Get info error:', error.message);
    return null;
  }
}

// ==========================================
// Cleanup
// ==========================================

/**
 * Close Redis connection gracefully
 */
async function close() {
  if (redis) {
    try {
      await redis.quit();
      console.log('[Redis] Connection closed gracefully');
    } catch (error) {
      console.error('[Redis] Error closing connection:', error.message);
      redis.disconnect();
    }
    redis = null;
    isConnected = false;
  }
}

// Initialize on module load
initRedis();

module.exports = {
  // Client
  getClient,
  isAvailable,
  getStatus,

  // Caching
  get,
  set,
  del,
  getOrSet,
  clearCache,

  // Sessions
  setSession,
  getSession,
  deleteSession,
  extendSession,

  // Rate limiting
  checkRateLimit,

  // Pending connections
  setPendingConnection,
  getPendingConnection,
  deletePendingConnection,

  // Schema caching
  cacheSchema,
  getCachedSchema,

  // Distributed locks
  acquireLock,
  releaseLock,

  // Health
  ping,
  getInfo,
  close,

  // Constants
  TTL,
  PREFIX,
};
