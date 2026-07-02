# 07 — Contracts (schemas, APIs, events)

Concrete shapes so implementation starts from copy-pasteable contracts, not prose.
All types are zod schemas in `packages/core/src/schema/` — the single type source;
DB rows and API payloads derive from these.

## Core domain types

```ts
// ---- ingest ----
const Segment = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  position: z.number().int(),
  text: z.string(),
  startSec: z.number().nullable(),   // null for text-ingested (silent) projects
  endSec: z.number().nullable(),
});

// ---- script ----
const DialogueKind = z.enum(["speech", "thought", "narration", "sfx"]);
const Dialogue = z.object({
  id: z.string().uuid(),
  beatId: z.string().uuid(),
  position: z.number().int(),
  speakerEntryId: z.string().uuid().nullable(), // null = narrator/unknown
  speakerConfidence: z.enum(["high", "low"]),   // low → flagged in storyboard review
  kind: DialogueKind,
  line: z.string().max(220),          // letterable text, NOT the raw source
  sourceSegmentId: z.string().uuid(), // audio-sync anchor
});

const Beat = z.object({
  id: z.string().uuid(),
  sceneId: z.string().uuid(),
  position: z.number().int(),
  summary: z.string(),                // one sentence, visual
  action: z.string(),                 // what is physically happening
  emotionalBeat: z.string(),          // "dread", "relief", "triumph"
  segmentStart: z.number().int(),     // inclusive positions into segments
  segmentEnd: z.number().int(),       // inclusive
});

const Scene = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  position: z.number().int(),
  title: z.string(),
  summary: z.string(),
  locationEntryId: z.string().uuid().nullable(),
  tone: z.string(),
  timeOfDay: z.enum(["day","night","dusk","dawn","interior","unknown"]),
  segmentStart: z.number().int(),
  segmentEnd: z.number().int(),
});

// ---- bible ----
const BibleEntry = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  kind: z.enum(["character", "location", "object", "lore"]),
  name: z.string(),
  aliases: z.array(z.string()),
  summary: z.string(),
  visualSpec: z.string(),             // canonical visual description; see 08-prompts
  evidence: z.array(z.object({ quote: z.string(), chapterId: z.string().uuid() })),
  firstChapterId: z.string().uuid(),
  status: z.enum(["proposed", "active", "retired"]),
});

const CastRef = z.object({
  id: z.string().uuid(),
  bibleEntryId: z.string().uuid(),
  version: z.number().int(),
  kind: z.enum(["portrait", "full_body", "establishing"]),
  imageKey: z.string(),
  prompt: z.string(),
  status: z.enum(["candidate", "approved", "rejected"]),
});

// ---- storyboard ----
const Camera = z.object({
  shot: z.enum(["establishing", "wide", "medium", "close_up", "extreme_close_up", "over_shoulder", "birds_eye", "low_angle"]),
  note: z.string().optional(),        // "from behind the door", etc.
});

const Panel = z.object({
  id: z.string().uuid(),
  pageId: z.string().uuid(),
  slot: z.number().int(),             // index into the page template's slots
  beatId: z.string().uuid(),
  description: z.string(),            // visual description, editable
  camera: Camera,
  characterEntryIds: z.array(z.string().uuid()).max(4),
  locationEntryId: z.string().uuid().nullable(),
  mood: z.string(),
  prompt: z.string(),                 // compiled by core/prompt.ts, then editable
  negativePrompt: z.string(),
  aspect: z.enum(["1:1", "2:3", "3:2", "16:9", "9:16", "4:3", "3:4"]),
  seed: z.number().int().nullable(),
  activeRenderId: z.string().uuid().nullable(),
  qaStatus: z.enum(["pending", "passed", "warn", "failed"]),
  qaNotes: z.string().nullable(),
});

const Page = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  position: z.number().int(),
  templateId: z.string(),             // key into the layout template library
});

// layout template — slots are normalized bboxes; see 09 for the seeded library
const LayoutTemplate = z.object({
  id: z.string(),                     // "grid-2x2", "splash", "tall-left-2r", ...
  name: z.string(),
  slots: z.array(z.object({
    x: z.number(), y: z.number(),     // 0..1, top-left origin
    w: z.number(), h: z.number(),
    aspect: Panel.shape.aspect,       // derived from bbox at page ratio 2:3
  })).min(1).max(9),
  tags: z.array(z.string()),          // ["dialogue","action","splash","dense"]
});

// ---- lettering ----
const Bubble = z.object({
  id: z.string().uuid(),
  panelId: z.string().uuid(),
  dialogueId: z.string().uuid().nullable(),  // null for user-added bubbles
  kind: DialogueKind,
  text: z.string(),
  bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }), // normalized to panel
  tail: z.object({ x: z.number(), y: z.number() }).nullable(),  // tip point, normalized
  autoPlaced: z.boolean(),
  position: z.number().int(),         // reading order within panel
});

// ---- render ----
const Render = z.object({
  id: z.string().uuid(),
  panelId: z.string().uuid(),
  version: z.number().int(),
  imageKey: z.string(),
  provider: z.string(),
  model: z.string(),
  promptUsed: z.string(),
  refsUsed: z.array(z.object({ bibleEntryId: z.string().uuid(), imageKey: z.string() })),
  seed: z.number().int().nullable(),
});
```

## Stage contracts

Every stage implements:

```ts
type StageName = "ingest" | "script" | "cast" | "storyboard" | "render" | "letter" | "publish";

type StageResult =
  | { ok: true; note?: string }
  | { ok: false; retryable: true; error: string }
  | { ok: false; retryable: false; error: string };

interface StageCtx {
  projectId: string;
  chapterId: string | null;   // null for project-scoped stages (cast)
  deps: Adapters;             // llm, image, transcriber, embedder, blobs
  db: Repo;
  progress: (current: number, total: number, note?: string) => Promise<void>;
  signal: AbortSignal;        // cancellation
}

type Stage = (ctx: StageCtx) => Promise<StageResult>;
```

Rules:
- A stage reads ONLY committed DB rows + blobs; writes rows + blobs; never calls another stage.
- A stage MUST begin by querying which outputs already exist and skip them (idempotency).
- A stage MUST call `progress` at item granularity (per scene, per panel).

## Chapter state machine

```
ingested → scripted → casting*        (* only while cast gate open for this project)
→ storyboarding → awaiting_storyboard_approval   [GATE 2]
→ rendering → lettering → published
any → failed(stage_error)  — retryable from the failed stage
```

Project-level gate 1: `projects.cast_status: building | awaiting_approval | approved`.
Chapters queue behind gate 1 for their *new* characters only (mini-gate).

Transitions are performed by the worker on stage completion; gates are advanced by API
mutation (`approve` endpoints). No other component mutates `chapters.stage`.

## API surface (App Router route handlers)

```
POST   /api/projects                          create (multipart: files + style + title)
GET    /api/projects                          list
GET    /api/projects/:id                      detail (chapters + statuses + cost)
PATCH  /api/projects/:id/settings
GET    /api/projects/:id/events               SSE (project-level: chapter status, progress)

GET    /api/projects/:id/cast                 bible entries + candidate refs
POST   /api/cast/:entryId/refs                regenerate candidates {note?}
POST   /api/cast/:entryId/refs/upload         user-provided image
PATCH  /api/cast/:entryId                     edit visualSpec / pick approved ref
POST   /api/projects/:id/cast/approve         gate 1

GET    /api/chapters/:id/storyboard           scenes+beats+pages+panels+dialogue
PATCH  /api/scenes/:id | /api/beats/:id | /api/dialogues/:id | /api/panels/:id
POST   /api/pages/:id/template                {templateId}  (re-slot panels)
POST   /api/panels/:id/split | /api/panels/:id/merge
POST   /api/chapters/:id/storyboard/approve   gate 2 → enqueue render

POST   /api/panels/:id/render                 regenerate {note?, seed?}
PATCH  /api/panels/:id/active-render          {renderId}
POST   /api/chapters/:id/rerender             {filter: "qa_failed" | "character:<entryId>" | "all"}

GET    /api/panels/:id/bubbles                overlay data
POST/PATCH/DELETE /api/bubbles/:id            editing → triggers recompose job

GET    /api/chapters/:id/manifest             reader manifest (public, cacheable)
POST   /api/chapters/:id/export               {kind: cbz|pdf|mp4} → job; GET returns presigned URL

POST   /api/chapters/:id/retry                re-enqueue failed stage
```

## SSE event shapes

One stream per project (`/api/projects/:id/events`), newline-JSON:

```ts
type Event =
  | { t: "chapter"; chapterId: string; stage: ChapterStage; error?: string }
  | { t: "progress"; chapterId: string; stage: StageName; current: number; total: number; note?: string }
  | { t: "panel"; panelId: string; renderId: string; qa: QaStatus }   // live fill-in during render
  | { t: "cast"; entryId: string; refId: string }                      // candidate ready
  | { t: "cost"; projectId: string; totalUsd: number };
```

Implementation: Postgres `LISTEN/NOTIFY` from worker → fan-out in the route handler.
Fallback poll (5s) in the client if the stream drops.

## Reader manifest (the publish contract)

```ts
const Manifest = z.object({
  version: z.literal(1),
  chapterId: z.string().uuid(),
  title: z.string(),
  audioUrl: z.string().nullable(),      // presigned or public; null = silent mode
  durationSec: z.number().nullable(),
  pages: z.array(z.object({
    imageUrl: z.string(),               // composed page WITHOUT bubbles
    w: z.number(), h: z.number(),
    panels: z.array(z.object({
      panelId: z.string().uuid(),
      bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
      imageUrl: z.string(),             // raw panel render (for panel-by-panel mode)
      startSec: z.number().nullable(),  // timing map
      endSec: z.number().nullable(),
      bubbles: z.array(Bubble.omit({ panelId: true })),
    })),
  })),
});
```

The reader is a pure function of this JSON. Bubbles render client-side (SVG) in both
page and panel modes; exports burn them in server-side. Panel `startSec/endSec` come
from timing math (09) — the manifest is regenerated on any edit (cheap).

## Adapter interfaces (full)

```ts
interface LLM {
  generateObject<T>(args: {
    schema: z.ZodType<T>;
    system: string;
    prompt: string;
    tier: "strong" | "fast";           // resolved to provider/model via settings
    maxRetries?: number;               // default 2 (repair + escalate); see 09 wrapper spec
  }): Promise<{ value: T; usage: Usage }>;
}

interface ImageGen {
  render(args: {
    prompt: string;
    negative?: string;
    refs: Array<{ bytes: Uint8Array; role: "character" | "location" | "style" }>;
    aspect: Aspect;
    seed?: number;
  }): Promise<{ png: Uint8Array; usage: Usage }>;
  capabilities(): { maxRefs: number; maxPromptChars: number; nativeAspects: Aspect[] };
}

interface Transcriber {
  transcribe(args: { audio: Uint8Array; mime: string; language?: string })
    : Promise<{ segments: Array<{ text: string; startSec: number; endSec: number }>; usage: Usage }>;
}

interface Embedder { embed(texts: string[]): Promise<{ vectors: number[][]; usage: Usage }>; }

interface BlobStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  presign(key: string, ttlSec?: number): Promise<string>;
}

type Usage = { provider: string; model: string; inputTokens?: number;
               outputTokens?: number; images?: number; estCostUsd: number };
```

Every adapter call reports `Usage`; the engine writes it to `usage_events` automatically
(wrap adapters once, not per call site).
