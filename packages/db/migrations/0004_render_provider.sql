-- 0004_render_provider.sql
-- Per-project render provider selection (pollinations-free | pollinations-paid).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS render_provider varchar(64);
