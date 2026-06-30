-- 0007_prompt_stale.sql
-- Tracks whether a panel's render prompt needs LLM re-optimization.
-- All existing panels default to stale = true so the optimize_prompts
-- pipeline step processes them on first run.

ALTER TABLE panel_specs
  ADD COLUMN IF NOT EXISTS prompt_stale boolean NOT NULL DEFAULT true;
