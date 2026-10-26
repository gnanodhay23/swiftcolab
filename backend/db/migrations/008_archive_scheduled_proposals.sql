-- Keep proposal history for audit, but remove completed items from active proposal work.

ALTER TABLE interview_schedule_proposals
    DROP CONSTRAINT IF EXISTS interview_schedule_proposals_status_check;

ALTER TABLE interview_schedule_proposals
    ADD CONSTRAINT interview_schedule_proposals_status_check
    CHECK (status IN ('draft', 'selected', 'rejected', 'superseded'));

ALTER TABLE interview_schedule_proposals
    ADD COLUMN IF NOT EXISTS scheduled_execution_id UUID REFERENCES interview_schedule_executions(id) ON DELETE SET NULL;
