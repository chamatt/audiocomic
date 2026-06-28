-- 0002_add_chapter_id_to_pages_panels.sql
-- Adds chapter_id to page_specs and panel_specs so pages and panels
-- are linked to the chapter they belong to, enabling per-chapter
-- story planning and canvas navigation by chapter.

ALTER TABLE page_specs ADD COLUMN IF NOT EXISTS chapter_id UUID;
ALTER TABLE panel_specs ADD COLUMN IF NOT EXISTS chapter_id UUID;

CREATE INDEX IF NOT EXISTS page_specs_chapter_id_idx ON page_specs (chapter_id);
CREATE INDEX IF NOT EXISTS panel_specs_chapter_id_idx ON panel_specs (chapter_id);
