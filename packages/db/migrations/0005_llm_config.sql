ALTER TABLE projects ADD COLUMN IF NOT EXISTS llm_provider varchar(64);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS llm_model varchar(128);
