-- Sprint 1: read-only mock interview scheduling proposals.

CREATE TABLE IF NOT EXISTS interview_scheduling_configs (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    workday_start SMALLINT NOT NULL DEFAULT 9 CHECK (workday_start BETWEEN 0 AND 23),
    workday_end SMALLINT NOT NULL DEFAULT 18 CHECK (workday_end BETWEEN 1 AND 24),
    default_duration_minutes SMALLINT NOT NULL DEFAULT 60 CHECK (default_duration_minutes BETWEEN 15 AND 240),
    buffer_minutes SMALLINT NOT NULL DEFAULT 15 CHECK (buffer_minutes BETWEEN 0 AND 120),
    minimum_notice_hours SMALLINT NOT NULL DEFAULT 24 CHECK (minimum_notice_hours BETWEEN 0 AND 720),
    search_days SMALLINT NOT NULL DEFAULT 14 CHECK (search_days BETWEEN 1 AND 60),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CHECK (workday_end > workday_start)
);

CREATE TABLE IF NOT EXISTS interview_schedule_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    source_type VARCHAR(30) NOT NULL DEFAULT 'fixture' CHECK (source_type IN ('fixture', 'google')),
    source_assignment_id VARCHAR(255) NOT NULL,
    source_snapshot JSONB NOT NULL,
    timezone VARCHAR(100) NOT NULL,
    duration_minutes SMALLINT NOT NULL,
    proposed_slots JSONB NOT NULL DEFAULT '[]',
    conflict_reasons JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'selected', 'rejected')),
    selected_slot JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_schedule_proposals_organization_created
    ON interview_schedule_proposals (organization_id, created_at DESC);

DROP TRIGGER IF EXISTS update_interview_scheduling_configs_updated_at ON interview_scheduling_configs;
CREATE TRIGGER update_interview_scheduling_configs_updated_at
    BEFORE UPDATE ON interview_scheduling_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_interview_schedule_proposals_updated_at ON interview_schedule_proposals;
CREATE TRIGGER update_interview_schedule_proposals_updated_at
    BEFORE UPDATE ON interview_schedule_proposals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
