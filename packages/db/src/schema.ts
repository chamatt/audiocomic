// Drizzle table definitions for every @audiocomic/domain entity.
//
// Column naming: TS properties are camelCase (matching the Zod schemas); the
// `casing: 'snake_case'` option configured in drizzle.config.ts and createDb()
// maps them to snake_case SQL columns automatically. The hand-written
// migration in migrations/0000_initial.sql uses the same snake_case names.
//
// Datetimes are stored as `timestamp with time zone` in string mode so rows
// round-trip to the ISO strings the domain Zod schemas expect without any
// Date conversion. Enum fields are `text` (validated at the repository layer
// by the Zod schemas). Complex/array fields are `jsonb`. Embedding columns are
// pgvector `vector(1536)`, nullable (they are DB-only and not part of the
// domain Zod schemas, which carry an `embeddingKey` string instead).

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Shared column helpers
// ---------------------------------------------------------------------------

const pkUuid = () => uuid('id').primaryKey().defaultRandom();
const projectFk = () => uuid('project_id').notNull();
const createdAtCol = () =>
  timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
const updatedAtCol = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
const embeddingCol = () => vector('embedding', { dimensions: 1536 });

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projects = pgTable(
  'projects',
  {
    id: pkUuid(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    status: text('status').notNull().default('created'),
    modality: text('modality').notNull(),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
    providerSettings: jsonb('provider_settings').notNull().default({}),
    stages: jsonb('stages').notNull().default([]),
  },
  (t) => [index('projects_status_idx').on(t.status)],
);

// ---------------------------------------------------------------------------
// Source assets
// ---------------------------------------------------------------------------

export const sourceAssets = pgTable(
  'source_assets',
  {
    id: pkUuid(),
    projectId: projectFk(),
    modality: text('modality').notNull(),
    filename: varchar('filename', { length: 512 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    durationSec: real('duration_sec'),
    checksum: text('checksum'),
    chapterId: uuid('chapter_id'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [index('source_assets_project_id_idx').on(t.projectId)],
);

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export const transcriptChunks = pgTable(
  'transcript_chunks',
  {
    id: pkUuid(),
    projectId: projectFk(),
    index: integer('index').notNull(),
    text: text('text').notNull(),
    start: real('start'),
    end: real('end'),
    words: jsonb('words'),
    confidence: real('confidence'),
    chapterId: uuid('chapter_id'),
    embedding: embeddingCol(),
  },
  (t) => [index('transcript_chunks_project_id_idx').on(t.projectId)],
);

export const speakerTurns = pgTable(
  'speaker_turns',
  {
    id: pkUuid(),
    projectId: projectFk(),
    index: integer('index').notNull(),
    speaker: varchar('speaker', { length: 255 }).notNull(),
    start: real('start').notNull(),
    end: real('end').notNull(),
    text: text('text').notNull(),
    chunkIds: jsonb('chunk_ids').notNull().default([]),
  },
  (t) => [index('speaker_turns_project_id_idx').on(t.projectId)],
);

// ---------------------------------------------------------------------------
// Story structure
// ---------------------------------------------------------------------------

export const storySections = pgTable(
  'story_sections',
  {
    id: pkUuid(),
    projectId: projectFk(),
    parentId: uuid('parent_id'),
    level: text('level').notNull(),
    index: integer('index').notNull(),
    title: varchar('title', { length: 512 }),
    summary: text('summary').notNull(),
    text: text('text'),
    startSec: real('start_sec'),
    endSec: real('end_sec'),
    wordStartIndex: integer('word_start_index'),
    wordEndIndex: integer('word_end_index'),
    charactersPresent: jsonb('characters_present').notNull().default([]),
    sceneId: uuid('scene_id'),
    emotionalTone: text('emotional_tone').notNull().default('neutral'),
    cameraHint: text('camera_hint'),
    objects: jsonb('objects').notNull().default([]),
    embeddingKey: text('embedding_key'),
    embedding: embeddingCol(),
  },
  (t) => [
    index('story_sections_project_id_idx').on(t.projectId),
    index('story_sections_parent_id_idx').on(t.parentId),
    index('story_sections_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

// ---------------------------------------------------------------------------
// Bibles — character, scene, object, world
// ---------------------------------------------------------------------------

export const characterProfiles = pgTable(
  'character_profiles',
  {
    id: pkUuid(),
    projectId: projectFk(),
    name: varchar('name', { length: 255 }).notNull(),
    aliases: jsonb('aliases').notNull().default([]),
    description: text('description').notNull(),
    role: text('role').notNull().default('supporting'),
    canonicalFaceRef: text('canonical_face_ref'),
    canonicalBodyRef: text('canonical_body_ref'),
    outfitRefs: jsonb('outfit_refs').notNull().default([]),
    paletteNotes: jsonb('palette_notes').notNull().default([]),
    negativeConstraints: jsonb('negative_constraints').notNull().default([]),
    embeddingKey: text('embedding_key'),
    locked: boolean('locked').notNull().default(false),
    embedding: embeddingCol(),
  },
  (t) => [
    index('character_profiles_project_id_idx').on(t.projectId),
    index('character_profiles_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export const sceneProfiles = pgTable(
  'scene_profiles',
  {
    id: pkUuid(),
    projectId: projectFk(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull(),
    locationType: text('location_type').notNull().default('outdoor'),
    timeOfDay: text('time_of_day').notNull().default('unknown'),
    weather: text('weather'),
    paletteNotes: jsonb('palette_notes').notNull().default([]),
    referenceImageKey: text('reference_image_key'),
    embeddingKey: text('embedding_key'),
    embedding: embeddingCol(),
  },
  (t) => [
    index('scene_profiles_project_id_idx').on(t.projectId),
    index('scene_profiles_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export const objectProfiles = pgTable(
  'object_profiles',
  {
    id: pkUuid(),
    projectId: projectFk(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull(),
    referenceImageKey: text('reference_image_key'),
    firstAppearanceSectionId: uuid('first_appearance_section_id'),
    embeddingKey: text('embedding_key'),
    embedding: embeddingCol(),
  },
  (t) => [
    index('object_profiles_project_id_idx').on(t.projectId),
    index('object_profiles_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export const worldBibles = pgTable(
  'world_bibles',
  {
    id: pkUuid(),
    projectId: projectFk(),
    setting: text('setting').notNull(),
    genre: jsonb('genre').notNull().default([]),
    tone: text('tone'),
    artStyle: text('art_style'),
    artStyleNegative: jsonb('art_style_negative').notNull().default([]),
    colorPalette: jsonb('color_palette').notNull().default([]),
    worldRules: jsonb('world_rules').notNull().default([]),
    embeddingKey: text('embedding_key'),
    embedding: embeddingCol(),
  },
  (t) => [
    index('world_bibles_project_id_idx').on(t.projectId),
    index('world_bibles_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

// ---------------------------------------------------------------------------
// Layout — pages and panels
// ---------------------------------------------------------------------------

export const pageSpecs = pgTable(
  'page_specs',
  {
    id: pkUuid(),
    projectId: projectFk(),
    chapterId: uuid('chapter_id'),
    index: integer('index').notNull(),
    storySectionId: uuid('story_section_id'),
    panelIds: jsonb('panel_ids').notNull().default([]),
    panelCount: integer('panel_count').notNull(),
    readingOrder: jsonb('reading_order').notNull().default([]),
    emphasisWeights: jsonb('emphasis_weights').notNull().default({}),
    bleedGutter: jsonb('bleed_gutter').notNull().default({}),
    layoutValid: boolean('layout_valid').notNull().default(false),
    layoutIssues: jsonb('layout_issues').notNull().default([]),
    compositeId: uuid('composite_id'),
  },
  (t) => [index('page_specs_project_id_idx').on(t.projectId), index('page_specs_chapter_id_idx').on(t.chapterId)],
);

export const panelSpecs = pgTable(
  'panel_specs',
  {
    id: pkUuid(),
    pageId: uuid('page_id').notNull(),
    projectId: projectFk(),
    chapterId: uuid('chapter_id'),
    index: integer('index').notNull(),
    storySectionId: uuid('story_section_id').notNull(),
    bbox: jsonb('bbox').notNull(),
    zIndex: integer('z_index').notNull().default(0),
    description: text('description').notNull(),
    cameraFraming: text('camera_framing'),
    characters: jsonb('characters').notNull().default([]),
    dialogueLines: jsonb('dialogue_lines').notNull().default([]),
    startSec: real('start_sec'),
    endSec: real('end_sec'),
    renderPrompt: text('render_prompt'),
    renderNegativePrompt: text('render_negative_prompt'),
    renderPresetId: uuid('render_preset_id'),
    seed: integer('seed'),
    renderResultId: uuid('render_result_id'),
    qaStatus: text('qa_status').notNull().default('pending'),
    qaNotes: text('qa_notes'),
  },
  (t) => [
    index('panel_specs_project_id_idx').on(t.projectId),
    index('panel_specs_story_section_id_idx').on(t.storySectionId),
    index('panel_specs_chapter_id_idx').on(t.chapterId),
  ],
);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export const renderPresets = pgTable(
  'render_presets',
  {
    id: pkUuid(),
    projectId: uuid('project_id'),
    name: varchar('name', { length: 255 }).notNull(),
    backend: text('backend').notNull(),
    model: varchar('model', { length: 255 }).notNull(),
    loraSet: jsonb('lora_set').notNull().default([]),
    ipAdapterRefs: jsonb('ip_adapter_refs').notNull().default([]),
    controlNetControls: jsonb('control_net_controls').notNull().default([]),
    aspectRatio: text('aspect_ratio').notNull().default('3:4'),
    qualityTier: text('quality_tier').notNull().default('standard'),
    steps: integer('steps').notNull().default(30),
    cfgScale: real('cfg_scale').notNull().default(7),
    sampler: text('sampler'),
    scheduler: text('scheduler'),
    negativePrompt: text('negative_prompt'),
  },
  (t) => [index('render_presets_project_id_idx').on(t.projectId)],
);

export const panelRenderRequests = pgTable(
  'panel_render_requests',
  {
    id: pkUuid(),
    panelId: uuid('panel_id').notNull(),
    projectId: projectFk(),
    prompt: text('prompt').notNull(),
    negativePrompt: text('negative_prompt'),
    presetId: uuid('preset_id'),
    preset: jsonb('preset'),
    referenceImageKeys: jsonb('reference_image_keys').notNull().default([]),
    seed: integer('seed'),
    width: integer('width').notNull().default(768),
    height: integer('height').notNull().default(1024),
    version: integer('version').notNull().default(0),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('panel_render_requests_project_id_idx').on(t.projectId),
    index('panel_render_requests_panel_id_idx').on(t.panelId),
  ],
);

export const panelRenderResults = pgTable(
  'panel_render_results',
  {
    id: pkUuid(),
    panelId: uuid('panel_id').notNull(),
    projectId: projectFk(),
    requestId: uuid('request_id').notNull(),
    backend: text('backend').notNull(),
    imageKey: text('image_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    seed: integer('seed'),
    durationMs: real('duration_ms'),
    costEstimate: real('cost_estimate'),
    modelUsed: text('model_used'),
    promptHash: text('prompt_hash'),
    createdAt: createdAtCol(),
    accepted: boolean('accepted').notNull().default(false),
  },
  (t) => [
    index('panel_render_results_project_id_idx').on(t.projectId),
    index('panel_render_results_panel_id_idx').on(t.panelId),
  ],
);

// ---------------------------------------------------------------------------
// Composition and lettering
// ---------------------------------------------------------------------------

export const pageComposites = pgTable(
  'page_composites',
  {
    id: pkUuid(),
    pageId: uuid('page_id').notNull(),
    projectId: projectFk(),
    imageKey: text('image_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    panelImageKeys: jsonb('panel_image_keys').notNull().default([]),
    createdAt: createdAtCol(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('page_composites_project_id_idx').on(t.projectId),
    index('page_composites_page_id_idx').on(t.pageId),
  ],
);

export const letteringSpecs = pgTable(
  'lettering_specs',
  {
    id: pkUuid(),
    pageId: uuid('page_id').notNull(),
    projectId: projectFk(),
    boxes: jsonb('boxes').notNull().default([]),
    overlayKey: text('overlay_key'),
    version: integer('version').notNull().default(0),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('lettering_specs_project_id_idx').on(t.projectId),
    index('lettering_specs_page_id_idx').on(t.pageId),
  ],
);

// ---------------------------------------------------------------------------
// Narration timeline and export
// ---------------------------------------------------------------------------

export const narrationTimelines = pgTable(
  'narration_timelines',
  {
    id: pkUuid(),
    projectId: projectFk(),
    segments: jsonb('segments').notNull().default([]),
    totalDurationSec: real('total_duration_sec'),
    audioKey: text('audio_key'),
    ttsGenerated: boolean('tts_generated').notNull().default(false),
  },
  (t) => [index('narration_timelines_project_id_idx').on(t.projectId)],
);

export const exportBundles = pgTable(
  'export_bundles',
  {
    id: pkUuid(),
    projectId: projectFk(),
    type: text('type').notNull(),
    storageKey: text('storage_key').notNull(),
    pageRange: jsonb('page_range'),
    sectionId: uuid('section_id'),
    createdAt: createdAtCol(),
    sizeBytes: integer('size_bytes'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => [index('export_bundles_project_id_idx').on(t.projectId)],
);

// ---------------------------------------------------------------------------
// Job tracking
// ---------------------------------------------------------------------------

export const jobs = pgTable(
  'jobs',
  {
    id: pkUuid(),
    projectId: projectFk(),
    type: text('type').notNull(),
    state: text('state').notNull(),
    currentStage: text('current_stage'),
    progress: real('progress').notNull().default(0),
    payload: jsonb('payload').notNull().default({}),
    result: jsonb('result'),
    error: text('error'),
    createdAt: createdAtCol(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    index('jobs_project_id_idx').on(t.projectId),
    index('jobs_state_idx').on(t.state),
  ],
);
// ---------------------------------------------------------------------------
// Chapters — first-class chapter entity per project
// ---------------------------------------------------------------------------

export const chapters = pgTable(
  'chapters',
  {
    id: pkUuid(),
    projectId: projectFk(),
    index: integer('index').notNull(),
    title: varchar('title', { length: 512 }).notNull(),
    description: text('description'),
    sourceAssetId: uuid('source_asset_id'),
    status: text('status').notNull().default('pending'),
    durationSec: real('duration_sec'),
    transcriptionStatus: text('transcription_status').notNull().default('pending'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('chapters_project_id_idx').on(t.projectId),
    index('chapters_project_order_idx').on(t.projectId, t.index),
  ],
);

// ---------------------------------------------------------------------------
// Character states — temporal character state per chapter
// ---------------------------------------------------------------------------

export const characterStates = pgTable(
  'character_states',
  {
    id: pkUuid(),
    projectId: projectFk(),
    characterId: uuid('character_id').notNull(),
    chapterId: uuid('chapter_id').notNull(),
    chapterIndex: integer('chapter_index').notNull(),
    outfit: text('outfit'),
    location: text('location'),
    mood: text('mood'),
    relationships: jsonb('relationships').notNull().default([]),
    notes: text('notes'),
    provenance: text('provenance'),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('character_states_project_char_idx').on(t.projectId, t.characterId),
    index('character_states_char_chapter_idx').on(t.characterId, t.chapterId),
  ],
);

// ---------------------------------------------------------------------------
// Knowledge pages — LLM-wiki structured knowledge entries
// ---------------------------------------------------------------------------

export const knowledgePages = pgTable(
  'knowledge_pages',
  {
    id: pkUuid(),
    projectId: projectFk(),
    type: text('type').notNull(),
    title: varchar('title', { length: 512 }).notNull(),
    content: text('content').notNull(),
    references: jsonb('references').notNull().default([]),
    crossReferences: jsonb('cross_references').notNull().default([]),
    confidence: real('confidence').notNull().default(1),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('knowledge_pages_project_id_idx').on(t.projectId),
    index('knowledge_pages_project_type_idx').on(t.projectId, t.type),
  ],
);

// ---------------------------------------------------------------------------
// Knowledge embeddings — vector embeddings for RAG over chapter transcriptions
// ---------------------------------------------------------------------------

export const knowledgeEmbeddings = pgTable(
  'knowledge_embeddings',
  {
    id: pkUuid(),
    projectId: projectFk(),
    chapterId: uuid('chapter_id'),
    chunkIndex: integer('chunk_index').notNull(),
    text: text('text').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    embedding: embeddingCol(),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('knowledge_embeddings_project_id_idx').on(t.projectId),
  ],
);


// ---------------------------------------------------------------------------
// Re-exported row types (inferred from the Drizzle schema)
// ---------------------------------------------------------------------------

export type ProjectRow = typeof projects.$inferSelect;
export type SourceAssetRow = typeof sourceAssets.$inferSelect;
export type TranscriptChunkRow = typeof transcriptChunks.$inferSelect;
export type SpeakerTurnRow = typeof speakerTurns.$inferSelect;
export type StorySectionRow = typeof storySections.$inferSelect;
export type CharacterProfileRow = typeof characterProfiles.$inferSelect;
export type SceneProfileRow = typeof sceneProfiles.$inferSelect;
export type ObjectProfileRow = typeof objectProfiles.$inferSelect;
export type WorldBibleRow = typeof worldBibles.$inferSelect;
export type PageSpecRow = typeof pageSpecs.$inferSelect;
export type PanelSpecRow = typeof panelSpecs.$inferSelect;
export type RenderPresetRow = typeof renderPresets.$inferSelect;
export type PanelRenderRequestRow = typeof panelRenderRequests.$inferSelect;
export type PanelRenderResultRow = typeof panelRenderResults.$inferSelect;
export type PageCompositeRow = typeof pageComposites.$inferSelect;
export type LetteringSpecRow = typeof letteringSpecs.$inferSelect;
export type NarrationTimelineRow = typeof narrationTimelines.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type ChapterRow = typeof chapters.$inferSelect;
export type CharacterStateRow = typeof characterStates.$inferSelect;
export type KnowledgePageRow = typeof knowledgePages.$inferSelect;
export type KnowledgeEmbeddingRow = typeof knowledgeEmbeddings.$inferSelect;
