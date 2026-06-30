import { z } from "zod";

// ============================================================================
// Core enums and shared types
// ============================================================================

export const ProjectStatus = z.enum([
  "created",
  "ingesting",
  "planning",
  "rendering",
  "composing",
  "exporting",
  "completed",
  "failed",
]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const SourceModality = z.enum(["audio", "text"]);
export type SourceModality = z.infer<typeof SourceModality>;

export const ProjectStage = z.enum([
  "normalize",
  "transcribe",
  "segment",
  "plan_story",
  "build_bibles",
  "section_memory",
  "plan_pages",
  "validate_layout",
  "compose_prompts",
  "render_panels",
  "panel_qa",
  "compose_pages",
  "lettering",
  "export_static",
  "export_motion",
]);
export type ProjectStage = z.infer<typeof ProjectStage>;

export const StageState = z.enum(["pending", "running", "completed", "failed", "skipped"]);
export type StageState = z.infer<typeof StageState>;

// ============================================================================
// Provider settings (defined early; referenced by Project)
// ============================================================================

export const ProviderSettings = z.object({
  transcriptionProvider: z.enum(["openai", "deepgram", "groq", "assemblyai", "fal"]).optional(),
  llmProvider: z.enum(["openai", "anthropic", "google", "groq", "mistral"]).optional(),
  llmModel: z.string().optional(),
  imageProvider: z
    .enum(["comfyui", "openai", "fal", "stability", "pollinations", "placeholder"])
    .optional(),
  imageModel: z.string().optional(),
  ttsProvider: z.enum(["openai", "elevenlabs", "coqui"]).optional(),
  ttsVoice: z.string().optional(),
  rendererBackend: z.enum(["comfyui", "aisdk", "pollinations", "placeholder"]).optional(),
});
export type ProviderSettings = z.infer<typeof ProviderSettings>;

// ============================================================================
// Project
// ============================================================================

export const Project = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  status: ProjectStatus.default("created"),
  modality: SourceModality,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  providerSettings: ProviderSettings.default({}),
  // stage progress
  stages: z
    .array(
      z.object({
        stage: ProjectStage,
        state: StageState.default("pending"),
        startedAt: z.string().datetime().optional(),
        completedAt: z.string().datetime().optional(),
        error: z.string().optional(),
        attempts: z.number().int().nonnegative().default(0),
      }),
    )
    .default([]),
  renderModel: z.string().optional(), // e.g. "flux", "gptimage", "turbo"
  renderProvider: z.string().optional(), // e.g. "pollinations-free", "pollinations-paid"
  llmProvider: z.string().optional(), // "openrouter" | "pollinations" | "openai" | etc.
  llmModel: z.string().optional(), // model name, e.g. "mistralai/mistral-nemo" or "openai"
});
export type Project = z.infer<typeof Project>;

// ============================================================================
// Source Asset
// ============================================================================

export const SourceAsset = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  modality: SourceModality,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  storageKey: z.string(),
  durationSec: z.number().positive().optional(), // audio only
  checksum: z.string().optional(),
  chapterId: z.string().uuid().optional(), // NEW — links to Chapter
});
export type SourceAsset = z.infer<typeof SourceAsset>;

// ============================================================================
// Transcript
// ============================================================================

export const WordTiming = z.object({
  word: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
});
export type WordTiming = z.infer<typeof WordTiming>;

export const TranscriptChunk = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  index: z.number().int().nonnegative(),
  text: z.string(),
  start: z.number().nonnegative().optional(),
  end: z.number().nonnegative().optional(),
  words: z.array(WordTiming).optional(),
  speaker: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  chapterId: z.string().uuid().optional(), // NEW — links to Chapter
});
export type TranscriptChunk = z.infer<typeof TranscriptChunk>;

export const SpeakerTurn = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  index: z.number().int().nonnegative(),
  speaker: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
  chunkIds: z.array(z.string().uuid()).default([]),
});
export type SpeakerTurn = z.infer<typeof SpeakerTurn>;

// ============================================================================
// Story structure — MangaFlow-style section memory
// ============================================================================

export const StoryLevel = z.enum(["chapter", "scene", "beat"]);
export type StoryLevel = z.infer<typeof StoryLevel>;

export const EmotionalTone = z.enum([
  "neutral",
  "tense",
  "joyful",
  "sad",
  "angry",
  "fearful",
  "romantic",
  "mysterious",
  "epic",
  "comedic",
  "melancholic",
  "hopeful",
]);
export type EmotionalTone = z.infer<typeof EmotionalTone>;

export const CameraFraming = z.enum([
  "wide",
  "medium",
  "close-up",
  "extreme-close-up",
  "overhead",
  "low-angle",
  "pov",
  "establishing",
]);
export type CameraFraming = z.infer<typeof CameraFraming>;

export const StorySection = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(), // chapter -> scene -> beat
  level: StoryLevel,
  index: z.number().int().nonnegative(),
  title: z.string().optional(),
  summary: z.string(),
  text: z.string().optional(), // raw text for this section
  // timing from narration
  startSec: z.number().nonnegative().optional(),
  endSec: z.number().nonnegative().optional(),
  wordStartIndex: z.number().int().nonnegative().optional(),
  wordEndIndex: z.number().int().nonnegative().optional(),
  // story metadata
  charactersPresent: z.array(z.string()).default([]), // character profile ids
  sceneId: z.string().uuid().optional(),
  emotionalTone: EmotionalTone.default("neutral"),
  cameraHint: CameraFraming.optional(),
  objects: z.array(z.string()).default([]),
  // section memory embedding key
  embeddingKey: z.string().optional(),
});
export type StorySection = z.infer<typeof StorySection>;

// ============================================================================
// Bibles — character, world, scene, object
// ============================================================================

export const CharacterProfile = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  description: z.string(),
  role: z
    .enum(["protagonist", "antagonist", "supporting", "minor", "narrator"])
    .default("supporting"),
  // visual anchors
  canonicalFaceRef: z.string().optional(), // storage key for face sheet
  canonicalBodyRef: z.string().optional(),
  outfitRefs: z
    .array(
      z.object({
        sectionId: z.string().uuid().optional(),
        storageKey: z.string(),
        description: z.string(),
      }),
    )
    .default([]),
  paletteNotes: z.array(z.string()).default([]),
  // negative constraints (what to avoid)
  negativeConstraints: z.array(z.string()).default([]),
  // consistency embedding
  embeddingKey: z.string().optional(),
  locked: z.boolean().default(false), // user-locked face/outfit
});
export type CharacterProfile = z.infer<typeof CharacterProfile>;

export const SceneProfile = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  locationType: z.enum(["indoor", "outdoor", "abstract", "vehicle"]).default("outdoor"),
  timeOfDay: z.enum(["dawn", "day", "dusk", "night", "unknown"]).default("unknown"),
  weather: z.string().optional(),
  paletteNotes: z.array(z.string()).default([]),
  referenceImageKey: z.string().optional(),
  embeddingKey: z.string().optional(),
});
export type SceneProfile = z.infer<typeof SceneProfile>;

export const ObjectProfile = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  referenceImageKey: z.string().optional(),
  firstAppearanceSectionId: z.string().uuid().optional(),
  embeddingKey: z.string().optional(),
});
export type ObjectProfile = z.infer<typeof ObjectProfile>;

export const WorldBible = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  setting: z.string(),
  genre: z.array(z.string()).default([]),
  tone: z.string().optional(),
  artStyle: z.string().optional(),
  artStyleNegative: z.array(z.string()).default([]),
  colorPalette: z.array(z.string()).default([]),
  worldRules: z.array(z.string()).default([]),
  embeddingKey: z.string().optional(),
});
export type WorldBible = z.infer<typeof WorldBible>;

// ============================================================================
// Layout — page and panel specs (generated BEFORE rendering)
// ============================================================================

export const BoundingBox = z.object({
  x: z.number().min(0).max(1), // normalized 0-1 relative to page
  y: z.number().min(0).max(1),
  w: z.number().min(0.05).max(1),
  h: z.number().min(0.05).max(1),
});
export type BoundingBox = z.infer<typeof BoundingBox>;

export const PanelSpec = z.object({
  id: z.string().uuid(),
  pageId: z.string().uuid(),
  projectId: z.string().uuid(),
  chapterId: z.string().uuid().optional(), // links panel to its chapter
  index: z.number().int().nonnegative(),
  storySectionId: z.string().uuid(), // MUST reference a StorySection
  // layout
  bbox: BoundingBox,
  zIndex: z.number().int().nonnegative().default(0),
  // content
  description: z.string(), // visual description of the panel
  cameraFraming: CameraFraming.optional(),
  characters: z
    .array(
      z.object({
        characterId: z.string().uuid(),
        pose: z.string().optional(),
        expression: z.string().optional(),
        position: z.enum(["left", "center", "right", "background"]).optional(),
      }),
    )
    .default([]),
  dialogueLines: z
    .array(
      z.object({
        speaker: z.string(),
        text: z.string(),
        type: z.enum(["speech", "thought", "narration", "sfx"]).default("speech"),
      }),
    )
    .default([]),
  // timing for motion comic
  startSec: z.number().nonnegative().optional(),
  endSec: z.number().nonnegative().optional(),
  // render params (filled at compose-prompts stage)
  renderPrompt: z.string().optional(),
  renderNegativePrompt: z.string().optional(),
  renderPresetId: z.string().uuid().optional(),
  seed: z.number().int().optional(),
  // result
  renderResultId: z.string().uuid().optional(),
  // QA
  qaStatus: z.enum(["pending", "passed", "failed", "regenerate"]).default("pending"),
  qaNotes: z.string().optional(),
  promptStale: z.boolean().default(true),
});
export type PanelSpec = z.infer<typeof PanelSpec>;

export const PageSpec = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  chapterId: z.string().uuid().optional(), // links page to its chapter
  index: z.number().int().nonnegative(),
  storySectionId: z.string().uuid().optional(), // primary section for this page
  panelIds: z.array(z.string().uuid()).default([]),
  // layout metadata
  panelCount: z.number().int().positive(),
  readingOrder: z.array(z.string().uuid()).default([]), // panel ids in reading order
  emphasisWeights: z.record(z.string(), z.number()).default({}), // panelId -> weight
  bleedGutter: z
    .object({
      bleed: z.number().min(0).default(0),
      gutter: z.number().min(0).max(0.1).default(0.02),
    })
    .default({}),
  // validation
  layoutValid: z.boolean().default(false),
  layoutIssues: z.array(z.string()).default([]),
  // composite
  compositeId: z.string().uuid().optional(),
});
export type PageSpec = z.infer<typeof PageSpec>;

// ============================================================================
// Rendering
// ============================================================================

export const RenderPreset = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().optional(), // global if undefined
  name: z.string(),
  backend: z.enum(["comfyui", "aisdk", "pollinations", "placeholder"]),
  model: z.string(),
  loraSet: z
    .array(
      z.object({
        name: z.string(),
        weight: z.number().min(0).max(2).default(1),
      }),
    )
    .default([]),
  ipAdapterRefs: z.array(z.string()).default([]), // storage keys
  controlNetControls: z
    .array(
      z.object({
        type: z.enum(["pose", "lineart", "depth", "canny", "segment", "composition"]),
        imageKey: z.string(),
        weight: z.number().min(0).max(2).default(1),
      }),
    )
    .default([]),
  aspectRatio: z.enum(["1:1", "3:4", "2:3", "16:9", "4:3"]).default("3:4"),
  qualityTier: z.enum(["draft", "standard", "high"]).default("standard"),
  steps: z.number().int().positive().default(30),
  cfgScale: z.number().positive().default(7),
  sampler: z.string().optional(),
  scheduler: z.string().optional(),
  negativePrompt: z.string().optional(),
});
export type RenderPreset = z.infer<typeof RenderPreset>;

export const PanelRenderRequest = z.object({
  id: z.string().uuid(),
  panelId: z.string().uuid(),
  projectId: z.string().uuid(),
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  model: z.string().optional(), // override the renderer's default model
  provider: z.string().optional(), // override the renderer's provider/endpoint (e.g. "pollinations-free" | "pollinations-paid")
  presetId: z.string().uuid().optional(),
  preset: RenderPreset.optional(),
  // reference images (character packs, scene refs)
  referenceImageKeys: z.array(z.string()).default([]),
  seed: z.number().int().optional(),
  width: z.number().int().positive().default(768),
  height: z.number().int().positive().default(1024),
  // versioning
  version: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
});
export type PanelRenderRequest = z.infer<typeof PanelRenderRequest>;

export const PanelRenderResult = z.object({
  id: z.string().uuid(),
  panelId: z.string().uuid(),
  projectId: z.string().uuid(),
  requestId: z.string().uuid(),
  backend: z.enum(["comfyui", "aisdk", "pollinations", "placeholder"]),
  imageKey: z.string(), // storage key
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  seed: z.number().int().optional(),
  durationMs: z.number().nonnegative().optional(),
  costEstimate: z.number().nonnegative().optional(),
  // provenance
  modelUsed: z.string().optional(),
  promptHash: z.string().optional(),
  createdAt: z.string().datetime(),
  accepted: z.boolean().default(false),
});
export type PanelRenderResult = z.infer<typeof PanelRenderResult>;

// ============================================================================
// Composition and lettering
// ============================================================================

export const PageComposite = z.object({
  id: z.string().uuid(),
  pageId: z.string().uuid(),
  projectId: z.string().uuid(),
  imageKey: z.string(), // composed page image
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  panelImageKeys: z.array(z.string()).default([]), // in panel order
  createdAt: z.string().datetime(),
  version: z.number().int().nonnegative().default(0),
});
export type PageComposite = z.infer<typeof PageComposite>;

export const LetteringBox = z.object({
  id: z.string().uuid(),
  type: z.enum(["speech", "thought", "narration", "sfx", "caption"]),
  text: z.string(),
  // placement (normalized to page)
  bbox: BoundingBox,
  panelId: z.string().uuid().optional(),
  speaker: z.string().optional(),
  // style
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  tailTarget: z.object({ x: z.number(), y: z.number() }).optional(), // for speech bubbles
});
export type LetteringBox = z.infer<typeof LetteringBox>;

export const LetteringSpec = z.object({
  id: z.string().uuid(),
  pageId: z.string().uuid(),
  projectId: z.string().uuid(),
  boxes: z.array(LetteringBox).default([]),
  // rendered overlay image (SVG/PNG)
  overlayKey: z.string().optional(),
  version: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
});
export type LetteringSpec = z.infer<typeof LetteringSpec>;

// ============================================================================
// Narration timeline and export
// ============================================================================

export const NarrationSegment = z.object({
  panelId: z.string().uuid(),
  pageId: z.string().uuid(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  // motion params
  motion: z
    .enum(["static", "pan-left", "pan-right", "zoom-in", "zoom-out", "ken-burns"])
    .default("static"),
  motionParams: z
    .object({
      zoomStart: z.number().min(1).max(4).default(1),
      zoomEnd: z.number().min(1).max(4).default(1),
      panX: z.number().min(-1).max(1).default(0),
      panY: z.number().min(-1).max(1).default(0),
    })
    .default({}),
  text: z.string().optional(), // narration text for this segment
});
export type NarrationSegment = z.infer<typeof NarrationSegment>;

export const NarrationTimeline = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  segments: z.array(NarrationSegment).default([]),
  totalDurationSec: z.number().positive().optional(),
  audioKey: z.string().optional(), // original or TTS audio
  ttsGenerated: z.boolean().default(false),
});
export type NarrationTimeline = z.infer<typeof NarrationTimeline>;

export const ExportBundle = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: z.enum(["pages", "pdf", "cbz", "mp4", "panel_strip"]),
  storageKey: z.string(),
  pageRange: z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .optional(),
  sectionId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  sizeBytes: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ExportBundle = z.infer<typeof ExportBundle>;

// ============================================================================
// Job tracking (for durable workflow state)
// ============================================================================

export const JobRecord = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: z.enum([
    "full_pipeline",
    "regenerate_panel",
    "regenerate_page",
    "regenerate_scene",
    "export",
  ]),
  state: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  currentStage: ProjectStage.optional(),
  progress: z.number().min(0).max(1).default(0),
  payload: z.record(z.string(), z.unknown()).default({}),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  attempts: z.number().int().nonnegative().default(0),
});
export type JobRecord = z.infer<typeof JobRecord>;

// ============================================================================
// Validation helpers
// ============================================================================

/** Validate that every panel references an existing StorySection */
export function validatePanelSectionRefs(
  panels: PanelSpec[],
  sectionIds: Set<string>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const panel of panels) {
    if (!sectionIds.has(panel.storySectionId)) {
      errors.push(`Panel ${panel.id} references missing section ${panel.storySectionId}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Deterministic layout validation — MangaFlow-style checks */
export function validatePageLayout(
  page: PageSpec,
  panels: PanelSpec[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const pagePanels = panels.filter((p) => p.pageId === page.id);

  // 1. Panel count check
  if (pagePanels.length !== page.panelCount) {
    errors.push(`Panel count mismatch: spec=${page.panelCount}, actual=${pagePanels.length}`);
  }

  // 2. Bounds check
  for (const panel of pagePanels) {
    const { bbox } = panel;
    if (bbox.x + bbox.w > 1.001) {
      errors.push(`Panel ${panel.id} exceeds right bound (${bbox.x + bbox.w})`);
    }
    if (bbox.y + bbox.h > 1.001) {
      errors.push(`Panel ${panel.id} exceeds bottom bound (${bbox.y + bbox.h})`);
    }
    if (bbox.w < 0.05 || bbox.h < 0.05) {
      errors.push(`Panel ${panel.id} too small (${bbox.w}x${bbox.h})`);
    }
  }

  // 3. Overlap check (rectangular)
  for (let i = 0; i < pagePanels.length; i++) {
    for (let j = i + 1; j < pagePanels.length; j++) {
      const a = pagePanels[i]!.bbox;
      const b = pagePanels[j]!.bbox;
      const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
      const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
      if (overlapX && overlapY) {
        errors.push(`Panels ${pagePanels[i]!.id} and ${pagePanels[j]!.id} overlap`);
      }
    }
  }

  // 4. Reading order check
  if (page.readingOrder.length !== pagePanels.length) {
    errors.push(
      `Reading order length (${page.readingOrder.length}) != panel count (${pagePanels.length})`,
    );
  }

  // 5. Blank space ratio (rough check — at least 10% should be covered)
  const totalArea = pagePanels.reduce((sum, p) => sum + p.bbox.w * p.bbox.h, 0);
  if (totalArea < 0.1) {
    errors.push(`Page coverage too low: ${(totalArea * 100).toFixed(1)}%`);
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Chapter — first-class entity with own audio, transcription, and pipeline
// ============================================================================

export const ChapterStatus = z.enum([
  "pending",
  "transcribing",
  "transcribed",
  "planning",
  "planned",
  "rendering",
  "completed",
  "failed",
]);
export type ChapterStatus = z.infer<typeof ChapterStatus>;

export const TranscriptionStatus = z.enum(["pending", "running", "completed", "failed", "skipped"]);
export type TranscriptionStatus = z.infer<typeof TranscriptionStatus>;

export const ChapterStage = z.enum([
  "pending",
  "transcribing",
  "ingesting",
  "planning",
  "ready_for_review",
  "rendering",
  "composing",
  "done",
  "failed",
]);
export type ChapterStage = z.infer<typeof ChapterStage>;

export const StageProgress = z.object({
  current: z.number(),
  total: z.number(),
  detail: z.string().optional(),
});
export type StageProgress = z.infer<typeof StageProgress>;

export const Chapter = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  index: z.number().int().nonnegative(),
  title: z.string().min(1),
  description: z.string().optional(),
  sourceAssetId: z.string().uuid().optional(),
  status: ChapterStatus.default("pending"),
  stage: ChapterStage.default("pending"),
  stageProgress: StageProgress.nullable().optional(),
  durationSec: z.number().positive().optional(),
  transcriptionStatus: TranscriptionStatus.default("pending"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Chapter = z.infer<typeof Chapter>;

// ============================================================================
// Character State — temporal character state per chapter (outfit, mood, etc.)
// ============================================================================

export const CharacterRelationship = z.object({
  targetCharacterId: z.string().uuid(),
  relationship: z.string(),
});
export type CharacterRelationship = z.infer<typeof CharacterRelationship>;

export const CharacterState = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  characterId: z.string().uuid(),
  chapterId: z.string().uuid(),
  chapterIndex: z.number().int().nonnegative(),
  outfit: z.string().optional(),
  location: z.string().optional(),
  mood: z.string().optional(),
  relationships: z.array(CharacterRelationship).default([]),
  notes: z.string().optional(),
  provenance: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type CharacterState = z.infer<typeof CharacterState>;

// ============================================================================
// Knowledge Page — LLM-wiki structured knowledge entries
// ============================================================================

export const KnowledgePageType = z.enum([
  "character",
  "location",
  "object",
  "concept",
  "event",
  "timeline",
]);
export type KnowledgePageType = z.infer<typeof KnowledgePageType>;

export const KnowledgeReference = z.object({
  chapterId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  chunkIndex: z.number().int().nonnegative().optional(),
  quote: z.string().optional(),
});
export type KnowledgeReference = z.infer<typeof KnowledgeReference>;

export const KnowledgePage = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: KnowledgePageType,
  title: z.string().min(1),
  content: z.string(),
  references: z.array(KnowledgeReference).default([]),
  crossReferences: z.array(z.string().uuid()).default([]),
  confidence: z.number().min(0).max(1).default(1),
  updatedAt: z.string().datetime(),
});
export type KnowledgePage = z.infer<typeof KnowledgePage>;
