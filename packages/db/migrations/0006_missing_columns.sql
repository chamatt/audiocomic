-- 0006_missing_columns.sql
-- Fix Drizzle ↔ migration drift:
-- 1. projects.render_model — declared in Drizzle schema, never migrated
-- 2. panel_render_requests.model — domain schema field, missing from DB
-- 3. panel_render_requests.provider — domain schema field, missing from DB

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS render_model varchar(64);

ALTER TABLE panel_render_requests
  ADD COLUMN IF NOT EXISTS model varchar(128);

ALTER TABLE panel_render_requests
  ADD COLUMN IF NOT EXISTS provider varchar(128);
