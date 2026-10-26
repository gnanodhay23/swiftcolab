-- Sprint 1: owner-controlled automatic scheduling with durable, idempotent records.

CREATE TABLE IF NOT EXISTS interview_scheduling_automation_settings (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    enabled_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interview_schedule_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source_assignment_id VARCHAR(255) NOT NULL,
    source_snapshot JSONB NOT NULL,
    requested_start TIMESTAMP WITH TIME ZONE,
    duration_minutes SMALLINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'scheduled', 'conflict', 'failed')),
    google_event_id VARCHAR(255),
    meeting_url TEXT,
    failure_reason TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    scheduled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, source_assignment_id)
);

CREATE INDEX IF NOT EXISTS idx_interview_schedule_executions_organization_status
    ON interview_schedule_executions (organization_id, status, created_at DESC);

DROP TRIGGER IF EXISTS update_interview_scheduling_automation_settings_updated_at ON interview_scheduling_automation_settings;
CREATE TRIGGER update_interview_scheduling_automation_settings_updated_at
    BEFORE UPDATE ON interview_scheduling_automation_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_interview_schedule_executions_updated_at ON interview_schedule_executions;
CREATE TRIGGER update_interview_schedule_executions_updated_at
    BEFORE UPDATE ON interview_schedule_executions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
