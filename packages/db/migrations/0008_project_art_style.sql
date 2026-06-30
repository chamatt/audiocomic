-- 0008_project_art_style.sql
-- Adds a project-level art style setting that defaults to "comic book art".
-- This is a user-editable config, NOT overwritten by the LLM planner.
-- The optimizer and renderer use this instead of the WorldBible's artStyle
-- (which gets overwritten on every planning run).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS art_style text NOT NULL DEFAULT 'comic book art';
