ALTER TABLE interview_scheduling_configs
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'fixture'
        CHECK (source IN ('fixture', 'google')),
    ADD COLUMN IF NOT EXISTS spreadsheet_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS sheet_range VARCHAR(255) NOT NULL DEFAULT 'Sheet1!A:G';
