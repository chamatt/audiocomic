-- 0003_per_chapter_stages.sql
-- Per-chapter pipeline: each chapter moves independently through stages.

-- Add stage and stage_progress columns to chapters table.
-- stage: transcribing | ingesting | planning | ready_for_review | rendering | composing | done | failed | pending
-- stage_progress: jsonb with { current, total, detail }
ALTER TABLE chapters
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stage_progress jsonb;

-- Track which chapters have been ingested into the knowledge base.
-- Prevents re-processing on subsequent runs.
CREATE TABLE IF NOT EXISTS chapter_ingest_log (
  chapter_id uuid PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  embeddings_count integer NOT NULL DEFAULT 0,
  wiki_pages_count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS chapter_ingest_log_project_idx
  ON chapter_ingest_log(project_id);
