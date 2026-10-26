-- Record and surface changes to already-scheduled Sheet rows.

ALTER TABLE interview_schedule_executions
    ADD COLUMN IF NOT EXISTS reschedule_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_rescheduled_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS interview_schedule_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id UUID NOT NULL REFERENCES interview_schedule_executions(id) ON DELETE CASCADE,
    event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('rescheduled')),
    previous_start TIMESTAMP WITH TIME ZONE,
    new_start TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_schedule_audit_events_execution
    ON interview_schedule_audit_events (execution_id, created_at DESC);
