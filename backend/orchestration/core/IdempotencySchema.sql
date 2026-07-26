-- IdempotencySchema.sql
-- Database schema for persistent execution state tracking
--
-- This schema supports the Multi-Layer Idempotency System
-- Replace the in-memory Map stores with database queries for production

-- ============================================================================
-- EXECUTION STATES TABLE
-- Primary table for tracking all execution attempts
-- ============================================================================

CREATE TABLE IF NOT EXISTS execution_states (
    id SERIAL PRIMARY KEY,

    -- Request identification
    request_id VARCHAR(128) NOT NULL UNIQUE,
    semantic_key VARCHAR(64) NOT NULL,

    -- Action information
    action_name VARCHAR(64) NOT NULL,
    params JSONB,  -- Sanitized params (sensitive fields redacted)

    -- State machine
    state VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- Valid states: pending, in_progress, completed, failed, retrying

    -- Timing
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Results
    result JSONB,  -- Cached result for completed executions
    error TEXT,    -- Error message for failed executions

    -- Retry tracking
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,

    -- Context
    user_id VARCHAR(64),
    session_id VARCHAR(128),
    entity_id VARCHAR(64),  -- Composio entity ID

    -- Provider tracking
    provider_resource_id VARCHAR(256),  -- e.g., Google Calendar event ID
    provider_duplicate_check BOOLEAN DEFAULT FALSE,

    -- Expiration
    expires_at TIMESTAMP WITH TIME ZONE,

    -- Constraints
    CONSTRAINT valid_state CHECK (state IN ('pending', 'in_progress', 'completed', 'failed', 'retrying'))
);

-- ============================================================================
-- INDEXES
-- Optimized for common query patterns
-- ============================================================================

-- Fast lookup by request_id (primary dedup check)
CREATE INDEX IF NOT EXISTS idx_exec_request_id ON execution_states(request_id);

-- Fast lookup by semantic_key (semantic dedup check)
CREATE INDEX IF NOT EXISTS idx_exec_semantic_key ON execution_states(semantic_key);

-- Find recent executions for an action (provider dedup)
CREATE INDEX IF NOT EXISTS idx_exec_action_created ON execution_states(action_name, created_at DESC);

-- Find executions by state (monitoring, cleanup)
CREATE INDEX IF NOT EXISTS idx_exec_state ON execution_states(state);

-- Find user's recent executions
CREATE INDEX IF NOT EXISTS idx_exec_user_created ON execution_states(user_id, created_at DESC);

-- Cleanup expired entries
CREATE INDEX IF NOT EXISTS idx_exec_expires ON execution_states(expires_at) WHERE expires_at IS NOT NULL;

-- Combined index for semantic dedup window check
CREATE INDEX IF NOT EXISTS idx_exec_semantic_state_created
    ON execution_states(semantic_key, state, created_at DESC);

-- ============================================================================
-- SEMANTIC KEY CACHE TABLE
-- Separate table for fast semantic key lookups with shorter TTL
-- ============================================================================

CREATE TABLE IF NOT EXISTS semantic_key_cache (
    semantic_key VARCHAR(64) PRIMARY KEY,
    request_id VARCHAR(128) NOT NULL,
    action_name VARCHAR(64) NOT NULL,
    state VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

    -- Reference to full execution record
    execution_id INTEGER REFERENCES execution_states(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires ON semantic_key_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_action ON semantic_key_cache(action_name, created_at DESC);

-- ============================================================================
-- AUDIT LOG TABLE
-- Track all idempotency checks for debugging and monitoring
-- ============================================================================

CREATE TABLE IF NOT EXISTS idempotency_audit_log (
    id SERIAL PRIMARY KEY,

    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Request info
    request_id VARCHAR(128),
    semantic_key VARCHAR(64),
    action_name VARCHAR(64),

    -- Check result
    check_type VARCHAR(32) NOT NULL,  -- request_id, semantic, provider
    result VARCHAR(20) NOT NULL,      -- allowed, blocked, duplicate
    reason TEXT,

    -- Duplicate info (if found)
    original_request_id VARCHAR(128),
    blocked_by VARCHAR(32),

    -- Context
    user_id VARCHAR(64),
    session_id VARCHAR(128)
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON idempotency_audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON idempotency_audit_log(action_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_request ON idempotency_audit_log(request_id);

-- ============================================================================
-- CLEANUP FUNCTIONS
-- Automated maintenance for old entries
-- ============================================================================

-- Function to clean up expired execution states
CREATE OR REPLACE FUNCTION cleanup_expired_executions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete expired entries
    DELETE FROM execution_states
    WHERE expires_at IS NOT NULL AND expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    -- Also delete very old completed/failed entries (30 days)
    DELETE FROM execution_states
    WHERE state IN ('completed', 'failed')
    AND created_at < NOW() - INTERVAL '30 days';

    GET DIAGNOSTICS deleted_count = deleted_count + ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up semantic key cache
CREATE OR REPLACE FUNCTION cleanup_semantic_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM semantic_key_cache
    WHERE expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old audit logs (keep 7 days)
CREATE OR REPLACE FUNCTION cleanup_audit_logs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM idempotency_audit_log
    WHERE timestamp < NOW() - INTERVAL '7 days';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HELPER VIEWS
-- Common queries as views for easier access
-- ============================================================================

-- View: Recent duplicates detected
CREATE OR REPLACE VIEW recent_duplicates AS
SELECT
    al.timestamp,
    al.action_name,
    al.request_id,
    al.original_request_id,
    al.blocked_by,
    al.reason,
    al.user_id
FROM idempotency_audit_log al
WHERE al.result = 'blocked'
AND al.timestamp > NOW() - INTERVAL '24 hours'
ORDER BY al.timestamp DESC;

-- View: Execution state summary
CREATE OR REPLACE VIEW execution_state_summary AS
SELECT
    action_name,
    state,
    COUNT(*) as count,
    MIN(created_at) as oldest,
    MAX(created_at) as newest
FROM execution_states
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY action_name, state
ORDER BY action_name, state;

-- View: Failed executions needing attention
CREATE OR REPLACE VIEW failed_executions AS
SELECT
    id,
    request_id,
    action_name,
    error,
    retry_count,
    max_retries,
    created_at,
    failed_at,
    user_id
FROM execution_states
WHERE state = 'failed'
AND retry_count >= max_retries
AND created_at > NOW() - INTERVAL '7 days'
ORDER BY failed_at DESC;

-- ============================================================================
-- SAMPLE QUERIES FOR APPLICATION USE
-- ============================================================================

-- Check if request_id exists and get state
-- SELECT state, result FROM execution_states WHERE request_id = $1;

-- Check for semantic duplicate within time window
-- SELECT request_id, state, result, created_at
-- FROM execution_states
-- WHERE semantic_key = $1
-- AND state = 'completed'
-- AND created_at > NOW() - INTERVAL '30 minutes'
-- LIMIT 1;

-- Register new execution
-- INSERT INTO execution_states (request_id, semantic_key, action_name, params, user_id, session_id, entity_id, expires_at)
-- VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '24 hours')
-- RETURNING id;

-- Update execution state
-- UPDATE execution_states
-- SET state = $2, last_updated = NOW(), started_at = CASE WHEN $2 = 'in_progress' THEN NOW() ELSE started_at END
-- WHERE request_id = $1;

-- Mark execution completed
-- UPDATE execution_states
-- SET state = 'completed', result = $2, completed_at = NOW(), last_updated = NOW()
-- WHERE request_id = $1;

-- Mark execution failed
-- UPDATE execution_states
-- SET state = 'failed', error = $2, failed_at = NOW(), last_updated = NOW()
-- WHERE request_id = $1;

-- Attempt retry
-- UPDATE execution_states
-- SET state = 'retrying', retry_count = retry_count + 1, last_updated = NOW()
-- WHERE request_id = $1 AND state = 'failed' AND retry_count < max_retries
-- RETURNING retry_count;
