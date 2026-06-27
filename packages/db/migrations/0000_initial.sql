-- audiocomic initial schema
-- Extension: pgvector

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- ============================================================================
-- projects
-- ============================================================================

CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "status" text DEFAULT 'created' NOT NULL,
  "modality" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "provider_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "stages" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint

CREATE INDEX "projects_status_idx" ON "projects" ("status");
--> statement-breakpoint

-- ============================================================================
-- source_assets
-- ============================================================================

CREATE TABLE "source_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "modality" text NOT NULL,
  "filename" varchar(512) NOT NULL,
  "mime_type" varchar(255) NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_key" text NOT NULL,
  "duration_sec" real,
  "checksum" text,
  "uploaded_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "source_assets_project_id_idx" ON "source_assets" ("project_id");
--> statement-breakpoint

-- ============================================================================
-- transcript_chunks
-- ============================================================================

CREATE TABLE "transcript_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "index" integer NOT NULL,
  "text" text NOT NULL,
  "start" real,
  "end" real,
  "words" jsonb,
  "speaker" text,
  "confidence" real
);
--> statement-breakpoint

CREATE INDEX "transcript_chunks_project_id_idx" ON "transcript_chunks" ("project_id");
--> statement-breakpoint

-- ============================================================================
-- speaker_turns
-- ============================================================================

CREATE TABLE "speaker_turns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "index" integer NOT NULL,
  "speaker" varchar(255) NOT NULL,
  "start" real NOT NULL,
  "end" real NOT NULL,
  "text" text NOT NULL,
  "chunk_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint

CREATE INDEX "speaker_turns_project_id_idx" ON "speaker_turns" ("project_id");
--> statement-breakpoint

-- ============================================================================
-- story_sections
-- ============================================================================

CREATE TABLE "story_sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "parent_id" uuid,
  "level" text NOT NULL,
  "index" integer NOT NULL,
  "title" varchar(512),
  "summary" text NOT NULL,
  "text" text,
  "start_sec" real,
  "end_sec" real,
  "word_start_index" integer,
  "word_end_index" integer,
  "characters_present" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "scene_id" uuid,
  "emotional_tone" text DEFAULT 'neutral' NOT NULL,
  "camera_hint" text,
  "objects" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "embedding_key" text,
  "embedding" vector(1536)
);
--> statement-breakpoint

CREATE INDEX "story_sections_project_id_idx" ON "story_sections" ("project_id");
--> statement-breakpoint

CREATE INDEX "story_sections_parent_id_idx" ON "story_sections" ("parent_id");
--> statement-breakpoint

CREATE INDEX "story_sections_embedding_hnsw" ON "story_sections" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- ============================================================================
-- character_profiles
-- ============================================================================

CREATE TABLE "character_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "description" text NOT NULL,
  "role" text DEFAULT 'supporting' NOT NULL,
  "canonical_face_ref" text,
  "canonical_body_ref" text,
  "outfit_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "palette_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "negative_constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "embedding_key" text,
  "locked" boolean DEFAULT false NOT NULL,
  "embedding" vector(1536)
);
--> statement-breakpoint

CREATE INDEX "character_profiles_project_id_idx" ON "character_profiles" ("project_id");
--> statement-breakpoint

CREATE INDEX "character_profiles_embedding_hnsw" ON "character_profiles" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- ============================================================================
-- scene_profiles
-- ============================================================================

CREATE TABLE "scene_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "location_type" text DEFAULT 'outdoor' NOT NULL,
  "time_of_day" text DEFAULT 'unknown' NOT NULL,
  "weather" text,
  "palette_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reference_image_key" text,
  "embedding_key" text,
  "embedding" vector(1536)
);
--> statement-breakpoint

CREATE INDEX "scene_profiles_project_id_idx" ON "scene_profiles" ("project_id");
--> statement-breakpoint

CREATE INDEX "scene_profiles_embedding_hnsw" ON "scene_profiles" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- ============================================================================
-- object_profiles
-- ============================================================================

CREATE TABLE "object_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "reference_image_key" text,
  "first_appearance_section_id" uuid,
  "embedding_key" text,
  "embedding" vector(1536)
);
--> statement-breakpoint

CREATE INDEX "object_profiles_project_id_idx" ON "object_profiles" ("project_id");
--> statement-breakpoint

CREATE INDEX "object_profiles_embedding_hnsw" ON "object_profiles" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- ============================================================================
-- world_bibles
-- ============================================================================

CREATE TABLE "world_bibles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "setting" text NOT NULL,
  "genre" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tone" text,
  "art_style" text,
  "art_style_negative" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "color_palette" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "world_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "embedding_key" text,
  "embedding" vector(1536)
);
--> statement-breakpoint

CREATE INDEX "world_bibles_project_id_idx" ON "world_bibles" ("project_id");
--> statement-breakpoint

CREATE INDEX "world_bibles_embedding_hnsw" ON "world_bibles" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- ============================================================================
-- page_specs
-- ============================================================================

CREATE TABLE "page_specs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "index" integer NOT NULL,
  "story_section_id" uuid,
  "panel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "panel_count" integer NOT NULL,
  "reading_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "emphasis_weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "bleed_gutter" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "layout_valid" boolean DEFAULT false NOT NULL,
  "layout_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "composite_id" uuid
);
--> statement-breakpoint

CREATE INDEX "page_specs_project_id_idx" ON "page_specs" ("project_id");
--> statement-breakpoint

-- ============================================================================
-- panel_specs
-- ============================================================================

CREATE TABLE "panel_specs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "index" integer NOT NULL,
  "story_section_id" uuid NOT NULL,
  "bbox" jsonb NOT NULL,
  "z_index" integer DEFAULT 0 NOT NULL,
  "description" text NOT NULL,
  "camera_framing" text,
  "characters" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "dialogue_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "start_sec" real,
  "end_sec" real,
  "render_prompt" text,
  "render_negative_prompt" text,
  "render_preset_id" uuid,
  "seed" integer,
  "render_result_id" uuid,
  "qa_status" text DEFAULT 'pending' NOT NULL,
  "qa_notes" text
);
--> statement-breakpoint

CREATE INDEX "panel_specs_project_id_idx" ON "panel_specs" ("project_id");
--> statement-breakpoint

CREATE INDEX "panel_specs_page_id_idx" ON "panel_specs" ("page_id");
--> statement-breakpoint

CREATE INDEX "panel_specs_story_section_id_idx" ON "panel_specs" ("story_section_id");
--> statement-breakpoint

-- ============================================================================
-- render_presets
-- ============================================================================

CREATE TABLE "render_presets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid,
  "name" varchar(255) NOT NULL,
  "backend" text NOT NULL,
  "model" varchar(255) NOT NULL,
  "lora_set" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "ip_adapter_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "control_net_controls" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "aspect_ratio" text DEFAULT '3:4' NOT NULL,
  "quality_tier" text DEFAULT 'standard' NOT NULL,
  "steps" integer DEFAULT 30 NOT NULL,
  "cfg_scale" real DEFAULT 7 NOT NULL,
  "sampler" text,
  "scheduler" text,
  "negative_prompt" text
);
--> statement-breakpoint

CREATE INDEX "render_presets_project_id_idx" ON "render_presets" ("project_id");
--> statement-breakpoint

-- ============================================================================
-- panel_render_requests
-- ============================================================================

CREATE TABLE "panel_render_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "panel_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "prompt" text NOT NULL,
  "negative_prompt" text,
  "preset_id" uuid,
  "preset" jsonb,
  "reference_image_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "seed" integer,
  "width" integer DEFAULT 768 NOT NULL,
  "height" integer DEFAULT 1024 NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "panel_render_requests_project_id_idx" ON "panel_render_requests" ("project_id");
--> statement-breakpoint

CREATE INDEX "panel_render_requests_panel_id_idx" ON "panel_render_requests" ("panel_id");
--> statement-breakpoint

-- ============================================================================
-- panel_render_results
-- ============================================================================

CREATE TABLE "panel_render_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "panel_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "backend" text NOT NULL,
  "image_key" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "seed" integer,
  "duration_ms" real,
  "cost_estimate" real,
  "model_used" text,
  "prompt_hash" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "accepted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint

CREATE INDEX "panel_render_results_project_id_idx" ON "panel_render_results" ("project_id");
--> statement-breakpoint

CREATE INDEX "panel_render_results_panel_id_idx" ON "panel_render_results" ("panel_id");
--> statement-breakpoint

-- ============================================================================
-- page_composites
-- ============================================================================

CREATE TABLE "page_composites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "image_key" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "panel_image_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint

CREATE INDEX "page_composites_project_id_idx" ON "page_composites" ("project_id");
--> statement-breakpoint

CREATE INDEX "page_composites_page_id_idx" ON "page_composites" ("page_id");
--> statement-breakpoint

-- ============================================================================
-- lettering_specs
-- ============================================================================

CREATE TABLE "lettering_specs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "boxes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "overlay_key" text,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "lettering_specs_project_id_idx" ON "lettering_specs" ("project_id");
--> statement-breakpoint

CREATE INDEX "lettering_specs_page_id_idx" ON "lettering_specs" ("page_id");
--> statement-breakpoint

-- ============================================================================
-- narration_timelines
-- ============================================================================

CREATE TABLE "narration_timelines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "total_duration_sec" real,
  "audio_key" text,
  "tts_generated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint

CREATE INDEX "narration_timelines_project_id_idx" ON "narration_timelines" ("project_id");
--> statement-breakpoint

-- ============================================================================
-- export_bundles
-- ============================================================================

CREATE TABLE "export_bundles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "type" text NOT NULL,
  "storage_key" text NOT NULL,
  "page_range" jsonb,
  "section_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "size_bytes" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint

CREATE INDEX "export_bundles_project_id_idx" ON "export_bundles" ("project_id");
--> statement-breakpoint

-- ============================================================================
-- jobs
-- ============================================================================

CREATE TABLE "jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "type" text NOT NULL,
  "state" text NOT NULL,
  "current_stage" text,
  "progress" real DEFAULT 0 NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result" jsonb,
  "error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint

CREATE INDEX "jobs_project_id_idx" ON "jobs" ("project_id");
--> statement-breakpoint

CREATE INDEX "jobs_state_idx" ON "jobs" ("state");
