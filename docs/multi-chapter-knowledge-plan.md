# Multi-Chapter Knowledge System — Implementation Plan

## Executive Summary

Transform AudioComic from a single-file pipeline into a multi-chapter knowledge system where:
- Projects contain multiple chapters, each with its own audio upload
- Transcription runs automatically at upload time per chapter
- A project-level knowledge base (RAG + structured wiki) is built from all chapter transcriptions
- Story planning uses tool-calling agents (Mastra) that retrieve character/world knowledge for cross-chapter consistency
- Character bible tracks temporal state (outfits, situations, relationships) across chapters
- Storage moves from local filesystem to S3-compatible (MinIO for local Docker)

---

## Current State Assessment

### What Exists
| Component | Status | Gap |
|-----------|--------|-----|
| **Pipeline DAG** | 15 steps, independent execution (Run/Retry/Skip/Invalidate) | Designed for single file → single run |
| **Step executors** | All 15 implemented with real adapters | `section_memory` is MVP stub (text matching, no embeddings) |
| **DB schema** | 19 tables, pgvector on 5 tables (HNSW indexes) | No chapter table, no embedding generation pipeline |
| **Bible actor** | In-memory: lore, characters[], chapters[] | No temporal tracking, no cross-chapter merging, no conflict resolution |
| **FileRegistry actor** | FS-based storage via Storage service | No S3, no multi-file per project |
| **Story planner** | 3-pass LLM (world→beats→panels) | Single-pass, no retrieval, no tool calling |
| **Web UI** | shadcn/ui, 3-tab project detail | Single file upload (base64 inline), no chapter management |
| **SSE events** | Real-time step progress | No chapter-level events |

### What's Missing
1. **Chapter entity** — first-class concept with own audio, transcription, and pipeline
2. **Multi-file upload** — dedicated upload endpoint, MediaManager abstraction
3. **S3-compatible storage** — MinIO Docker, storage abstraction layer
4. **Embedding pipeline** — generate embeddings from transcriptions, store in pgvector
5. **RAG retrieval** — semantic search over chapter transcriptions
6. **Knowledge base / LLM-wiki** — structured, compiled knowledge from all chapters
7. **Temporal character tracking** — character state per chapter with provenance
8. **Tool-calling agents** — Mastra agents with retrieval tools for story planning
9. **Cross-chapter bible merging** — incremental, conflict-aware knowledge consolidation
10. **Chapter management UI** — create, upload, reorder, view per-chapter progress

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Web UI (Next.js)                         │
│  Project Detail → Chapters Tab → Chapter Cards (upload, status)  │
│  Pipeline Tab → Per-chapter pipeline + Project-level knowledge    │
│  Knowledge Tab → Bible viewer, character timeline, wiki browser   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                    API Layer (Next.js Routes)                     │
│  /api/chapters/[id]/upload  /api/projects/[id]/knowledge         │
│  /api/chapters/[id]/transcribe  /api/projects/[id]/bible         │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                    Rivet Actor System                             │
│                                                                   │
│  FileRegistryActor ──▶ MediaManager (S3/MinIO)                   │
│       │                                                           │
│  ProjectActor                                                      │
│       ├── BibleActor (project-level, cross-chapter)               │
│       │     ├── CharacterState[] (temporal, per-chapter)          │
│       │     ├── WorldWiki (compiled knowledge pages)              │
│       │     └── ChapterSummary[]                                  │
│       │                                                           │
│       ├── ChapterActor (NEW — one per chapter)                    │
│       │     ├── PipelineActor (per-chapter pipeline)              │
│       │     └── ChapterState (transcription, segments, status)    │
│       │                                                           │
│       └── KnowledgeBaseActor (NEW — project-level)                │
│             ├── EmbeddingIndex (pgvector)                         │
│             ├── RetrievalTools (Mastra vector query tool)         │
│             └── WikiPages (compiled knowledge)                    │
│                                                                   │
│  Mastra Agents (story planner, bible builder)                     │
│       ├── vectorQueryTool (RAG over transcriptions)               │
│       ├── characterLookupTool (bible character state)             │
│       ├── worldLookupTool (bible world/setting)                   │
│       └── timelineTool (character state at chapter N)             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Storage Abstraction — MediaManager + S3

### Goal
Replace local filesystem storage with an S3-compatible abstraction. MinIO for local Docker, any S3-compatible provider for production.

### Design

**New package: `packages/storage/`**

```typescript
// packages/storage/src/types.ts
export interface MediaManager {
  upload(key: string, data: Buffer | ReadableStream, mimeType: string): Promise<UploadResult>;
  download(key: string): Promise<ReadableStream>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  size(key: string): Promise<number>;
  presignedUrl(key: string, expiresIn?: number): Promise<string>;
  list(prefix: string): Promise<FileInfo[]>;
}

export interface UploadResult {
  key: string;
  bucket: string;
  size: number;
  etag: string;
  mimeType: string;
}

// packages/storage/src/s3.ts — S3MediaManager
// Uses @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner
// Config: endpoint, region, accessKeyId, secretAccessKey, bucket, forcePathStyle
// For MinIO: endpoint=http://localhost:9000, forcePathStyle=true

// packages/storage/src/local.ts — LocalMediaManager (fallback, dev-only)
// Wraps existing writeAsset/readAsset from apps/web/src/lib/storage.ts
// Same interface, filesystem-backed

// packages/storage/src/factory.ts — createMediaManager(env)
// If S3_ENDPOINT set → S3MediaManager, else LocalMediaManager
```

**Docker Compose addition:**
```yaml
# docker-compose.yml (project root)
services:
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"  # S3 API
      - "9001:9001"  # Web console
    environment:
      MINIO_ROOT_USER: audiocomic
      MINIO_ROOT_PASSWORD: audiocomic-dev
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  minio-data:
```

**Env vars:**
```
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=audiocomic
S3_SECRET_ACCESS_KEY=audiocomic-dev
S3_BUCKET=audiocomic
S3_FORCE_PATH_STYLE=true
```

### Changes Required

1. **Create `packages/storage/`** — types.ts, s3.ts, local.ts, factory.ts, index.ts
2. **Update `FileRegistryActor`** — replace `Storage` service with `MediaManager` from `packages/storage/`
3. **Update `PipelineBridge`** — `storage` field changes from FS paths to MediaManager calls
4. **Update `apps/web/src/lib/storage.ts`** — re-export from `packages/storage/` or delegate
5. **Update `/api/assets/[...key]/route.ts`** — stream from MediaManager instead of FS
6. **Add `docker-compose.yml`** — MinIO service
7. **Update `.env`** — S3 config vars
8. **Add `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`** to workspace deps

### Storage Key Scheme
```
projects/{projectId}/chapters/{chapterId}/audio/{filename}
projects/{projectId}/chapters/{chapterId}/transcript.json
projects/{projectId}/panels/{panelId}/renders/{version}.jpg
projects/{projectId}/pages/{pageId}/composites/{version}.jpg
projects/{projectId}/exports/{exportId}/{filename}
```

---

## Phase 2: Chapter Entity — Domain, DB, Actor

### Goal
Make chapters first-class entities with their own audio, transcription, and pipeline. A project has many chapters. Each chapter has its own pipeline run.

### Domain Schema Changes (`packages/domain/src/schema.ts`)

```typescript
// NEW: Chapter schema
export const Chapter = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  index: z.number().int().min(0),          // order within project
  title: z.string(),
  description: z.string().optional(),
  sourceAssetId: z.string().uuid().optional(),  // linked SourceAsset
  status: ChapterStatus,                        // pending|transcribing|transcribed|planning|planned|rendering|completed|failed
  durationSec: z.number().optional(),
  transcriptionStatus: TranscriptionStatus,     // pending|running|completed|failed|skipped
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ChapterStatus = z.enum([
  'pending', 'transcribing', 'transcribed', 'planning', 'planned', 'rendering', 'completed', 'failed'
]);

export const TranscriptionStatus = z.enum([
  'pending', 'running', 'completed', 'failed', 'skipped'
]);

// UPDATE: SourceAsset — add optional chapterId
export const SourceAsset = z.object({
  // ...existing fields...
  chapterId: z.string().uuid().optional(),  // NEW — links asset to a chapter
});

// NEW: CharacterState — temporal character state per chapter
export const CharacterState = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  characterId: z.string().uuid(),       // → CharacterProfile
  chapterId: z.string().uuid(),         // → Chapter
  chapterIndex: z.number().int(),       // denormalized for ordering
  outfit: z.string().optional(),
  location: z.string().optional(),
  mood: z.string().optional(),
  relationships: z.array(z.object({
    targetCharacterId: z.string().uuid(),
    relationship: z.string(),           // "ally", "enemy", "rival", etc.
  })).default([]),
  notes: z.string().optional(),
  provenance: z.string().optional(),    // "extracted from chapter 3 transcription, scene 2"
  createdAt: z.string().datetime(),
});

// NEW: KnowledgePage — LLM-wiki structured knowledge
export const KnowledgePage = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: z.enum(['character', 'location', 'object', 'concept', 'event', 'timeline']),
  title: z.string(),
  content: z.string(),                  // markdown
  references: z.array(z.object({
    chapterId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    chunkIndex: z.number().int().optional(),
    quote: z.string().optional(),
  })).default([]),
  crossReferences: z.array(z.string().uuid()).default([]),  // → other KnowledgePage IDs
  confidence: z.number().min(0).max(1).default(1),
  updatedAt: z.string().datetime(),
});
```

### DB Schema Changes (`packages/db/src/schema.ts`)

```typescript
// NEW tables
export const chapters = pgTable('chapters', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  index: integer('index').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  sourceAssetId: uuid('source_asset_id'),
  status: text('status').notNull().default('pending'),
  durationSec: real('duration_sec'),
  transcriptionStatus: text('transcription_status').notNull().default('pending'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
}, (t) => ({
  projectIdIdx: index().on(t.projectId),
  projectOrderIdx: index().on(t.projectId, t.index),
}));

export const characterStates = pgTable('character_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  characterId: uuid('character_id').notNull(),
  chapterId: uuid('chapter_id').notNull(),
  chapterIndex: integer('chapter_index').notNull(),
  outfit: text('outfit'),
  location: text('location'),
  mood: text('mood'),
  relationships: jsonb('relationships').notNull().default([]),
  notes: text('notes'),
  provenance: text('provenance'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
}, (t) => ({
  projectCharIdx: index().on(t.projectId, t.characterId),
  charChapterIdx: index().on(t.characterId, t.chapterId),
}));

export const knowledgePages = pgTable('knowledge_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  references: jsonb('references').notNull().default([]),
  crossReferences: jsonb('cross_references').notNull().default([]),
  confidence: real('confidence').notNull().default(1),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
}, (t) => ({
  projectIdIdx: index().on(t.projectId),
  typeIdx: index().on(t.projectId, t.type),
}));

// UPDATE: source_assets — add chapter_id column
// ALTER TABLE source_assets ADD COLUMN chapter_id uuid;

// NEW: transcript_chunks — add chapter_id column (for multi-chapter transcripts)
// ALTER TABLE transcript_chunks ADD COLUMN chapter_id uuid;
// ALTER TABLE transcript_chunks ADD COLUMN embedding vector(1536);
// (embedding column enables per-chunk semantic search)
```

### Migration
New migration file: `packages/db/migrations/0001_chapters_and_knowledge.sql`
- Create `chapters`, `character_states`, `knowledge_pages` tables
- Add `chapter_id` column to `source_assets` and `transcript_chunks`
- Add `embedding vector(1536)` column to `transcript_chunks` with HNSW index
- Add indexes

### New Actor: ChapterActor

```
packages/actors/src/actors/chapter/
  api.ts    — Action contracts
  live.ts   — Implementation
```

**ChapterActor state:**
```typescript
{
  id: string,                    // chapter UUID
  projectId: string,
  index: number,
  title: string,
  description?: string,
  sourceAssetId?: string,
  status: ChapterStatus,
  transcriptionStatus: TranscriptionStatus,
  pipelineId?: string,           // linked PipelineActor instance
  durationSec?: number,
}
```

**ChapterActor actions:**
- `GetState` → ChapterState
- `UpdateTitle(title)` → ChapterState
- `UpdateDescription(desc)` → ChapterState
- `LinkAsset(assetId)` → ChapterState  — links a SourceAsset to this chapter
- `SetStatus(status)` → ChapterState
- `SetTranscriptionStatus(status)` → ChapterState
- `StartTranscription` → ChapterState  — triggers transcription immediately
- `GetPipelineStatus` → PipelineStatus  — delegates to linked PipelineActor

### Updated ProjectActor

Add actions:
- `AddChapter(chapterId, title, index)` → ProjectConfig  — registers a new chapter
- `RemoveChapter(chapterId)` → ProjectConfig
- `ListChapters` → ChapterState[]  — lists all chapters with status
- `ReorderChapters(chapterIds: string[])` → ProjectConfig  — reorders chapter indices

### Updated BibleActor

The BibleActor becomes project-level (already is) but gains temporal tracking:

**New BibleContent shape:**
```typescript
{
  id: string,
  title: string,
  lore: string,
  characters: CharacterEntry[],        // canonical character profiles
  chapters: ChapterSummary[],           // per-chapter summaries
  characterStates: CharacterStateEntry[], // temporal states per chapter
  worldWiki: WikiPage[],                // compiled world knowledge pages
  updatedAt: string,
}
```

**New/updated actions:**
- `AddCharacter(name, description)` → BibleContent  (existing)
- `UpdateCharacterState(characterId, chapterId, state)` → BibleContent  (NEW — temporal)
- `GetCharacterTimeline(characterId)` → CharacterState[]  (NEW — all states across chapters)
- `MergeChapterKnowledge(chapterId, extractedKnowledge)` → BibleContent  (NEW — incremental merge)
- `GetWiki` → WikiPage[]  (NEW)
- `UpdateWikiPage(pageId, content)` → BibleContent  (NEW)

---

## Phase 3: Transcription-at-Upload

### Goal
When a user uploads audio for a chapter, transcription runs automatically and independently. No need to start the full pipeline. The transcription is stored referencing the asset ID and chapter ID.

### Flow
```
User uploads audio →
  /api/chapters/[id]/upload (multipart, streams to MediaManager) →
    FileRegistryActor.RegisterFile(assetId) →
      ChapterActor.LinkAsset(assetId) →
        ChapterActor.StartTranscription →
          TranscriptionStep runs standalone (not full pipeline) →
            TranscriptChunks persisted with chapterId →
              ChapterActor.SetTranscriptionStatus('completed') →
                KnowledgeBaseActor.OnChapterTranscribed(chapterId) →
                  Embedding pipeline kicks off (Phase 4)
```

### Implementation

**New API route: `apps/web/src/app/api/chapters/[id]/upload/route.ts`**
- Accepts multipart form data (file upload)
- Streams file to MediaManager (no base64 encoding — direct stream)
- Creates SourceAsset record in DB
- Calls FileRegistryActor.RegisterFile
- Calls ChapterActor.LinkAsset + StartTranscription
- Returns chapter state

**Standalone transcription execution:**
The existing `TranscribeStep` executor already works independently. We create a lightweight wrapper that:
1. Creates a minimal pipeline with just `normalize → transcribe` steps
2. Runs it immediately
3. On completion, updates ChapterActor status
4. Triggers the knowledge base ingestion (Phase 4)

**Alternative (simpler):** Add a `TranscribeChapter` action to ChapterActor that directly calls the transcription adapter via PipelineBridge, bypassing the pipeline system for this one-off operation. This is cleaner because transcription-at-upload is not a pipeline step — it's a prerequisite.

```typescript
// ChapterActor live.ts — TranscribeChapter action
TranscribeChapter: Effect.fn(function*() {
  const bridge = yield* PipelineBridge;
  const state = yield* State.get(chapterStateSchema);
  
  // 1. Get audio path from MediaManager
  const asset = yield* bridge.repo.sourceAssets.getById(state.sourceAssetId!);
  const audioStream = yield* bridge.storage.download(asset.storageKey);
  
  // 2. Transcribe
  const adapter = yield* bridge.getTranscriptionAdapter();
  const chunks = yield* adapter.transcribe(audioStream, { 
    projectId: state.projectId, 
    chapterId: state.id 
  });
  
  // 3. Persist with chapterId
  for (const chunk of chunks) {
    yield* bridge.repo.transcriptChunks.create({ ...chunk, chapterId: state.id });
  }
  
  // 4. Update status
  yield* State.updateAndGet(chapterStateSchema, (s) => ({
    ...s, 
    transcriptionStatus: 'completed',
    status: 'transcribed',
  }));
  
  // 5. Trigger knowledge base ingestion
  yield* bridge.knowledgeBase.ingestChapter(state.id);
  
  return updatedState;
})
```

### TranscriptChunk changes
- Add `chapterId: string` to TranscriptChunk schema
- All transcription calls include `chapterId`
- DB: `transcript_chunks` table gets `chapter_id` column
- Existing `transcript_chunks` (from single-file era) get `chapterId = null` — backward compatible

---

## Phase 4: Knowledge Base — Embeddings + RAG

### Goal
Build a project-level knowledge base from all chapter transcriptions. Use pgvector (already set up) for semantic search. Enable agents to retrieve relevant context when planning stories.

### Embedding Pipeline

**New package: `packages/knowledge/`**

```typescript
// packages/knowledge/src/embeddings.ts
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
}

// GroqEmbeddingProvider — uses Groq's embedding API (free tier)
//   Model: llama-embed-v1 or similar (check availability)
// OpenAIEmbeddingProvider — text-embedding-3-small (1536 dims, cheap)
//   $0.02 per 1M tokens — fits cost-conscious constraint
// LocalEmbeddingProvider — transformers.js or sentence-transformers
//   For fully offline, no API cost

// packages/knowledge/src/chunking.ts
// Semantic chunking for transcriptions:
// - Split by speaker turns or ~30s windows
// - Overlap of 50-100 tokens
// - Preserve chapter/section metadata
export function chunkTranscription(
  chunks: TranscriptChunk[], 
  chapterId: string,
  options?: { targetTokens?: number; overlap?: number }
): Chunk[]

// packages/knowledge/src/ingest.ts
export function ingestChapterTranscription(
  repo: Repository,
  embedder: EmbeddingProvider,
  chapterId: string
): Effect<void>
// 1. Load all TranscriptChunks for chapter
// 2. Chunk into ~512-token segments with overlap
// 3. Generate embeddings
// 4. Store in transcript_chunks.embedding column (pgvector)
// 5. Also store in a dedicated knowledge_embeddings table for cross-chapter search
```

**New DB table for cross-chunk embeddings:**
```sql
CREATE TABLE knowledge_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  chapter_id UUID,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON knowledge_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON knowledge_embeddings (project_id);
```

### RAG Retrieval

**Using Mastra's RAG pipeline:**

```typescript
// packages/knowledge/src/rag.ts
import { createVectorQueryTool } from '@mastra/rag';
import { PgVector } from '@mastra/pg';
import { ModelRouterEmbeddingModel } from '@mastra/core/llm';

const pgVector = new PgVector({
  id: 'audiocomic-kb',
  connectionString: process.env.DATABASE_URL,
});

const vectorQueryTool = createVectorQueryTool({
  vectorStoreName: 'postgres',
  indexName: 'knowledge_embeddings',
  model: new ModelRouterEmbeddingModel('openai/text-embedding-3-small'),
  databaseConfig: {
    pgvector: {
      minScore: 0.7,
      ef: 200,
    },
  },
});
```

**Custom retrieval tools (beyond vector search):**

```typescript
// packages/knowledge/src/tools.ts

// 1. Character lookup tool — retrieves character profile + temporal state
const characterLookupTool = createTool({
  id: 'character-lookup',
  description: 'Retrieve character profile and state at a specific chapter. Use for consistency.',
  inputSchema: z.object({
    characterName: z.string(),
    atChapter: z.number().optional(),  // get state at this chapter
  }),
  execute: async ({ inputData, mastra }) => {
    const { characterName, atChapter } = inputData;
    // 1. Find character by name/alias in CharacterProfile
    // 2. If atChapter provided, get CharacterState at that chapter
    // 3. Return profile + state
  },
});

// 2. World lookup tool — retrieves world bible + wiki pages
const worldLookupTool = createTool({
  id: 'world-lookup',
  description: 'Retrieve world setting, rules, art style, and wiki pages.',
  inputSchema: z.object({
    topic: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    // 1. Get WorldBible for project
    // 2. If topic, filter wiki pages by relevance
    // 3. Return setting + rules + relevant pages
  },
});

// 3. Character timeline tool — tracks state changes across chapters
const timelineTool = createTool({
  id: 'character-timeline',
  description: 'Get the full timeline of a character\'s state across all chapters.',
  inputSchema: z.object({
    characterName: z.string(),
  }),
  execute: async ({ inputData }) => {
    // Return CharacterState[] ordered by chapterIndex
  },
});

// 4. Chapter context tool — retrieves transcription context from other chapters
const chapterContextTool = createTool({
  id: 'chapter-context',
  description: 'Search across all chapter transcriptions for relevant context.',
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().default(5),
  }),
  execute: async ({ inputData }) => {
    // Vector search over knowledge_embeddings
  },
});
```

---

## Phase 5: LLM-Wiki Knowledge Compilation

### Goal
Build a compiled, structured knowledge base (Karpathy's LLM-wiki pattern) from chapter transcriptions. This is complementary to RAG — RAG retrieves raw chunks, the wiki provides compiled, cross-referenced knowledge.

### Three-Layer Architecture

```
Layer 1: Raw Sources (immutable)
  → Chapter transcriptions (TranscriptChunks)
  → Story sections (StorySections)

Layer 2: Wiki (LLM-compiled, mutable)
  → KnowledgePages (character, location, object, concept, event, timeline)
  → Cross-references between pages
  → Provenance tracking (which chapter/section each fact came from)

Layer 3: Schema (governance)
  → AGENTS.md or wiki-schema.md defining:
    - Entity types and their required fields
    - Naming conventions
    - When to create vs update pages
    - Conflict resolution rules
```

### Wiki Operations

**Ingest** (triggered after each chapter transcription):
1. Read chapter transcription
2. Extract entities (characters, locations, objects, events)
3. For each entity:
   - If page exists → update with new information, add provenance
   - If new → create page with template
4. Update cross-references
5. Flag contradictions (e.g., character outfit changed)
6. Append to chapter log

**Query** (used by story planner agents):
1. Agent calls `worldLookupTool` or `characterLookupTool`
2. Tool reads compiled KnowledgePages
3. Returns structured, cross-referenced knowledge

**Lint** (periodic or on-demand):
1. Check for contradictions across pages
2. Check for orphan pages (no cross-references)
3. Check for missing information (gaps)
4. Generate fix recommendations

### Implementation

```typescript
// packages/knowledge/src/wiki.ts

export interface WikiIngestor {
  ingestChapter(chapterId: string): Effect<void>;
  lint(): Effect<LintReport>;
  query(topic: string): Effect<KnowledgePage[]>;
}

// wiki-ingestor.ts
export function makeWikiIngestor(
  repo: Repository,
  planner: StoryPlannerAdapter,
  embedder: EmbeddingProvider,
): WikiIngestor {
  return {
    ingestChapter: (chapterId) => Effect.gen(function*() {
      // 1. Load chapter transcription
      const chunks = yield* repo.transcriptChunks.getByProjectId(projectId);
      const chapterChunks = chunks.filter(c => c.chapterId === chapterId);
      const text = chapterChunks.map(c => c.text).join(' ');
      
      // 2. LLM extraction pass — extract entities + facts
      const extraction = yield* planner.extractWikiEntities(text, {
        chapterId,
        existingPages: yield* repo.knowledgePages.getByProjectId(projectId),
      });
      
      // 3. Merge into existing pages
      for (const entity of extraction.entities) {
        const existing = yield* findPageByTitle(repo, projectId, entity.name);
        if (existing) {
          // Update with new info, add provenance
          yield* repo.knowledgePages.patch(existing.id, {
            content: mergeContent(existing.content, entity.content, chapterId),
            references: [...existing.references, ...entity.references],
            updatedAt: new Date().toISOString(),
          });
        } else {
          // Create new page
          yield* repo.knowledgePages.create({
            projectId,
            type: entity.type,
            title: entity.name,
            content: entity.content,
            references: entity.references,
            crossReferences: entity.crossReferences,
          });
        }
      }
      
      // 4. Update cross-references
      yield* updateCrossReferences(repo, projectId, extraction.relationships);
      
      // 5. Flag contradictions
      const contradictions = extraction.entities.filter(e => 
        e.contradictsExisting === true
      );
      if (contradictions.length > 0) {
        yield* logContradictions(repo, projectId, contradictions);
      }
    }),
    
    lint: () => Effect.gen(function*() {
      const pages = yield* repo.knowledgePages.getByProjectId(projectId);
      // Check for orphans, contradictions, gaps
      // Return LintReport
    }),
    
    query: (topic) => Effect.gen(function*() {
      // Semantic search over KnowledgePages
      // Return relevant pages
    }),
  };
}
```

### Wiki Schema (governance file)
```markdown
# Wiki Schema — AudioComic Knowledge Base

## Entity Types
- **character**: Name, aliases, description, role, appearance, personality, first_appearance
- **location**: Name, type, description, first_appearance
- **object**: Name, description, significance, first_appearance
- **concept**: Name, description, related characters
- **event**: Name, description, chapter, characters involved, consequences
- **timeline**: Character state changes ordered by chapter

## Naming Conventions
- Character pages: Use canonical name (most frequently used)
- Location pages: Use descriptive name (e.g., "The Dungeon Entrance")
- Event pages: Include chapter reference (e.g., "Carl enters the dungeon (Ch. 3)")

## Update Rules
- When new info contradicts existing page: keep both, mark with `confidence: 0.5`
- When new info supplements existing page: merge, keep `confidence: 1`
- When entity appears in multiple chapters: accumulate provenance references

## Conflict Resolution
- Outfit changes: Create timeline entry, don't overwrite canonical appearance
- Relationship changes: Add new relationship state with chapter provenance
- Character death: Mark with `status: deceased` + chapter reference
```

---

## Phase 6: Mastra Agent Integration

### Goal
Replace the current 3-pass LLM story planner with Mastra agents that use tool calling to retrieve knowledge from the RAG + wiki, enabling cross-chapter consistency.

### Agent Design

**Story Planner Agent:**
```typescript
// packages/actors/src/agents/story-planner.ts
import { Agent } from '@mastra/core/agent';

const storyPlannerAgent = new Agent({
  id: 'story-planner',
  name: 'Story Planner',
  instructions: `You are a story planner for an audiobook-to-comic system.
  
  When planning a chapter:
  1. Use character-lookup to get each character's current state and appearance
  2. Use character-timeline to check for outfit/state changes across chapters
  3. Use world-lookup to get the world setting, rules, and art style
  4. Use chapter-context to find relevant events from other chapters
  5. Plan the story with consistency: characters should look and act the same
     as in previous chapters unless there's a narrative reason for change
  
  Output: structured JSON with world, characters, scenes, beats, panels.`,
  model: 'openrouter/mistralai/mistral-nemo',
  tools: {
    vectorQueryTool,       // RAG over transcriptions
    characterLookupTool,   // Bible character profiles + temporal state
    worldLookupTool,       // World bible + wiki pages
    timelineTool,          // Character state timeline across chapters
    chapterContextTool,    // Cross-chapter context search
  },
});
```

**Bible Builder Agent:**
```typescript
// packages/actors/src/agents/bible-builder.ts
const bibleBuilderAgent = new Agent({
  id: 'bible-builder',
  name: 'Bible Builder',
  instructions: `You build and maintain the story bible from chapter transcriptions.
  
  When processing a new chapter:
  1. Extract characters, locations, objects, events
  2. Use character-lookup to check if characters already exist
  3. Use character-timeline to track state changes (outfit, location, mood)
  4. Update the wiki with new information
  5. Flag contradictions with previous chapters
  
  Output: structured knowledge updates for the bible.`,
  model: 'openrouter/mistralai/mistral-nemo',
  tools: {
    characterLookupTool,
    worldLookupTool,
    timelineTool,
    vectorQueryTool,
  },
});
```

### Integration with Pipeline

The `plan_story` step executor is updated to use the Mastra agent instead of the direct 3-pass LLM:

```typescript
// Updated plan_story step
execute: async (ctx) => {
  const bridge = yield* PipelineBridge;
  const chapterId = ctx.config.chapterId;
  
  // 1. Get the story planner agent
  const agent = bridge.getStoryPlannerAgent();
  
  // 2. Agent generates with tool calls
  const result = await agent.generate(
    `Plan the comic adaptation for chapter: ${chapterTitle}\n\nTranscription: ${transcriptionText}`,
    {
      maxSteps: 20,  // allow multiple tool calls
      memory: {
        thread: `project-${projectId}`,
        resource: `chapter-${chapterId}`,
      },
    }
  );
  
  // 3. Parse structured output
  const plan = JSON.parse(result.text);
  
  // 4. Persist sections, characters, worldBible to DB
  // 5. Update bible with temporal character states
  // 6. Return step output
}
```

### Token Efficiency

The agent approach is more token-efficient than the current 3-pass approach because:
1. **Retrieval is targeted** — only relevant context is retrieved, not the entire transcription
2. **Knowledge is pre-compiled** — the wiki provides condensed knowledge, not raw chunks
3. **Tool calls are cheap** — each tool call returns structured data, not free-text reasoning
4. **Memory persists** — the agent remembers previous chapters' plans via Mastra memory

### Cost Estimate (mistral-nemo)
- Story planning per chapter: ~5-10 tool calls × ~500 tokens each + ~2000 tokens generation = ~7000 tokens
- At $0.02/$0.03 per 1M: ~$0.0002 per chapter
- Bible building per chapter: ~3-5 tool calls + ~1000 tokens generation = ~3500 tokens
- At $0.02/$0.03 per 1M: ~$0.0001 per chapter
- Total for 28-chapter book: ~$0.008

---

## Phase 7: Cross-Chapter Bible Merging

### Goal
When planning a new chapter, the system merges knowledge from all previous chapters. The bible tracks temporal state (outfits, relationships, situations) with provenance.

### Temporal Character State Tracking

**CharacterState records:**
```
Chapter 1: Carl — outfit: "t-shirt, jeans", location: "apartment", mood: "confused"
Chapter 2: Carl — outfit: "dungeon armor", location: "dungeon entrance", mood: "determined"
Chapter 3: Carl — outfit: "dungeon armor + cloak", location: "dungeon level 2", mood: "alert"
```

**Timeline query:**
```typescript
// When planning chapter 4, the agent calls timelineTool:
{
  character: "Carl",
  timeline: [
    { chapter: 1, outfit: "t-shirt, jeans", mood: "confused" },
    { chapter: 2, outfit: "dungeon armor", mood: "determined" },
    { chapter: 3, outfit: "dungeon armor + cloak", mood: "alert" },
  ]
}
// Agent knows: Carl should be wearing "dungeon armor + cloak" in chapter 4
// unless there's a narrative reason for change.
```

### Incremental Merge Algorithm

```
For each new chapter transcription:
  1. Extract entities + state changes (LLM)
  2. For each character mentioned:
     a. Find existing CharacterProfile (by name or alias)
     b. Extract CharacterState for this chapter
     c. Compare with previous chapter's state:
        - If outfit changed → record as intentional change with provenance
        - If relationship changed → record as evolving relationship
        - If new character → create CharacterProfile + initial state
  3. Update KnowledgePages with new information
  4. Update cross-references
  5. Flag contradictions (e.g., character dead in ch.3 but alive in ch.4)
```

### Conflict Resolution Rules

1. **Outfit/appearance changes**: Treated as intentional. Record in CharacterState timeline. Don't overwrite canonical appearance.
2. **Relationship changes**: Treated as evolving. Add new relationship state with chapter provenance.
3. **Contradictions** (character dead but appears alive): Flag with `confidence: 0.5`. LLM resolves in next lint pass.
4. **New aliases**: Add to `aliases[]` array on CharacterProfile. Don't create duplicate profiles.

---

## Phase 8: UI Changes

### Project Detail — New Tab Structure

```
Project Detail
├── Chapters Tab (NEW — replaces direct pipeline access)
│   ├── Chapter list (cards with status badges: pending/transcribing/planned/completed)
│   ├── "Add Chapter" button → modal with title + description + file upload
│   ├── Per-chapter: Upload audio, View transcription, Run pipeline, View artifacts
│   └── "Upload All Chapters" — batch upload, transcription runs in parallel
│
├── Pipeline Tab (existing, now per-chapter)
│   ├── Chapter selector dropdown
│   ├── Flow chart DAG for selected chapter's pipeline
│   ├── Step controls (run/retry/skip/invalidate)
│   └── SSE live updates
│
├── Knowledge Tab (NEW)
│   ├── Bible viewer (characters, world, scenes, objects)
│   ├── Character timeline (visual timeline of state changes across chapters)
│   ├── Wiki browser (KnowledgePages with search + filter by type)
│   └── Contradiction flags (if any)
│
├── Artifacts Tab (existing, now per-chapter)
│   ├── Chapter selector
│   ├── Pages, panels, exports for selected chapter
│   └── Cross-chapter artifact comparison
│
└── Settings Tab (existing)
    ├── Project info
    └── Provider config
```

### Chapter Upload UI

```tsx
// ChapterCard component
<Card>
  <CardHeader>
    <Badge>{status}</Badge>
    <CardTitle>{title}</CardTitle>
    <CardDescription>{duration}</CardDescription>
  </CardHeader>
  <CardContent>
    {status === 'pending' && <UploadButton />}
    {status === 'transcribing' && <ProgressIndicator />}
    {status === 'transcribed' && <ViewTranscriptionButton />}
    {status === 'planned' && <ViewArtifactsButton />}
    <RunPipelineButton />
  </CardContent>
</Card>
```

### New API Routes

```
POST   /api/chapters                    — create chapter (projectId, title, description)
POST   /api/chapters/[id]/upload        — upload audio (multipart stream)
GET    /api/chapters/[id]/transcription — get transcription
POST   /api/chapters/[id]/transcribe    — manually trigger transcription
GET    /api/chapters/[id]/status        — get chapter status
DELETE /api/chapters/[id]               — delete chapter
GET    /api/projects/[id]/chapters      — list chapters
PUT    /api/projects/[id]/chapters/reorder — reorder chapters
GET    /api/projects/[id]/knowledge     — get knowledge base (wiki pages, bible)
GET    /api/projects/[id]/bible         — get bible content
GET    /api/projects/[id]/characters/[charId]/timeline — character timeline
```

---

## Phase 9: New Actor — KnowledgeBaseActor

### Goal
Centralize knowledge base operations in a dedicated actor that coordinates embeddings, RAG, and wiki compilation.

```
packages/actors/src/actors/knowledge-base/
  api.ts    — Action contracts
  live.ts   — Implementation
```

**KnowledgeBaseActor state:**
```typescript
{
  projectId: string,
  embeddingStatus: Record<string, 'pending' | 'running' | 'completed' | 'failed'>,  // per chapterId
  wikiStatus: Record<string, 'pending' | 'running' | 'completed' | 'failed'>,       // per chapterId
  lastLintAt?: string,
  contradictionCount: number,
}
```

**Actions:**
- `IngestChapter(chapterId)` — runs embedding pipeline + wiki ingest for a chapter
- `GetStatus` → KnowledgeBaseStatus
- `Query(query, topK?)` → SearchResult[]  — RAG query
- `GetWiki` → KnowledgePage[]
- `Lint` → LintReport  — runs wiki health check
- `GetCharacterTimeline(characterId)` → CharacterState[]
- `SearchCharacters(query)` → CharacterProfile[]  — semantic search over characters

---

## Implementation Order

### Phase 1: Storage (MediaManager + S3) — ~2 days
1. Create `packages/storage/` with S3MediaManager + LocalMediaManager
2. Add `docker-compose.yml` with MinIO
3. Update FileRegistryActor to use MediaManager
4. Update PipelineBridge storage ops
5. Update asset serving route
6. Test: upload file → MinIO → retrieve

### Phase 2: Chapter Entity — ~3 days
1. Add Chapter schema to domain
2. Add chapters table to DB + migration
3. Create ChapterActor
4. Update ProjectActor with chapter management
5. Add chapter API routes
6. Update UI with Chapters tab
7. Test: create project → add chapters → upload audio per chapter

### Phase 3: Transcription-at-Upload — ~2 days
1. Add `TranscribeChapter` action to ChapterActor
2. Update TranscriptChunk with chapterId
3. Create upload API route with streaming
4. Wire upload → transcribe → status update flow
5. Test: upload audio → auto-transcribe → view transcription

### Phase 4: Knowledge Base (Embeddings + RAG) — ~3 days
1. Create `packages/knowledge/` with embedding providers
2. Add knowledge_embeddings table + migration
3. Implement chunking + embedding pipeline
4. Set up Mastra RAG with pgvector
5. Create KnowledgeBaseActor
6. Wire transcription completion → embedding ingestion
7. Test: transcribe chapter → embeddings generated → semantic search works

### Phase 5: LLM-Wiki — ~3 days
1. Add KnowledgePage schema to domain
2. Add knowledge_pages table to DB
3. Implement wiki ingestor with LLM extraction
4. Create wiki schema governance file
5. Implement lint operation
6. Test: transcribe chapters → wiki pages generated → query returns compiled knowledge

### Phase 6: Mastra Agents — ~3 days
1. Install Mastra (`@mastra/core`, `@mastra/rag`, `@mastra/pg`)
2. Create custom tools (characterLookup, worldLookup, timeline, chapterContext)
3. Create story planner agent with tools
4. Create bible builder agent with tools
5. Update `plan_story` step to use agent
6. Update `build_bibles` step to use agent
7. Test: plan chapter 2 → agent retrieves chapter 1 knowledge → consistent characters

### Phase 7: Cross-Chapter Bible Merging — ~2 days
1. Add CharacterState schema to domain
2. Add character_states table to DB
3. Update BibleActor with temporal tracking
4. Implement incremental merge algorithm
5. Implement conflict resolution
6. Test: upload 3 chapters → bible shows character timeline → outfit changes tracked

### Phase 8: UI — ~3 days
1. Add Chapters tab to ProjectDetail
2. Create ChapterCard component
3. Create chapter upload modal with streaming
4. Add Knowledge tab with wiki browser + character timeline
5. Update Pipeline tab with chapter selector
6. Update Artifacts tab with chapter selector
7. Test: full UI flow — create project → add chapters → upload → view knowledge → plan

### Phase 9: KnowledgeBaseActor — ~2 days
1. Create actor with ingest, query, lint, timeline actions
2. Wire to embedding pipeline + wiki ingestor
3. Register in server
4. Add to actor-actions.ts bridge
5. Test: actor coordinates knowledge base operations

**Total: ~23 days of implementation**

---

## Dependency Graph

```
Phase 1 (Storage) ──────────────────────────────────────────┐
                                                              │
Phase 2 (Chapter Entity) ──────────────┬──────────────────────┤
                                        │                      │
Phase 3 (Transcription-at-Upload) ─────┤                      │
                                        │                      │
Phase 4 (Embeddings + RAG) ────────────┤                      │
                                        │                      │
Phase 5 (LLM-Wiki) ────────────────────┤                      │
                                        │                      │
Phase 9 (KnowledgeBaseActor) ──────────┘                      │
                                        │                      │
Phase 6 (Mastra Agents) ───────────────┤                      │
                                        │                      │
Phase 7 (Cross-Chapter Merging) ───────┘                      │
                                        │                      │
Phase 8 (UI) ─────────────────────────────────────────────────┘
```

Phases 1-3 can be done sequentially (storage → chapters → transcription).
Phases 4-9 can be partially parallelized (4+5 in parallel, then 9, then 6+7, then 8).

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Mastra + Effect integration friction | Mastra agents are called from step executors as plain async functions — no Effect wrapping needed for the agent itself, only for DB ops |
| Embedding API costs | Use OpenAI text-embedding-3-small ($0.02/1M) or Groq free tier. For 28 chapters × ~10K tokens each = 280K tokens = $0.006 |
| MinIO Docker complexity | LocalMediaManager fallback ensures dev works without Docker. S3 is opt-in. |
| LLM-wiki quality | Start with simple extraction, iterate on wiki schema. Lint pass catches issues. |
| Cross-chapter merge conflicts | Provenance tracking + confidence scores + lint pass. Human review for low-confidence items. |
| RivetKit actor serialization (GetStatus timeout) | KnowledgeBaseActor runs ingestion as daemon fiber (same pattern as PipelineActor run loop). Status queries are fast reads. |
| Migration of existing data | New columns are nullable/optional. Existing single-file projects get a single implicit chapter. |

---

## Technology Choices Summary

| Need | Choice | Why |
|------|--------|-----|
| Object storage | MinIO (Docker) | S3-compatible, easy local dev, same SDK as production S3 |
| S3 SDK | @aws-sdk/client-s3 | Standard, well-maintained, TypeScript native |
| Vector store | pgvector (existing) | Already set up with HNSW indexes, no new infra |
| Embeddings | OpenAI text-embedding-3-small | 1536 dims (matches existing), $0.02/1M tokens, reliable |
| RAG framework | Mastra (@mastra/rag) | TypeScript-native, pgvector support, createVectorQueryTool |
| Agent framework | Mastra (@mastra/core) | Tool calling, memory, model routing, TypeScript-native |
| LLM | OpenRouter mistral-nemo | $0.02/$0.03 per 1M, 131K context, structured outputs |
| Transcription | Groq whisper-large-v3-turbo | Free tier, fast, already integrated |
| Image rendering | Pollinations z-image-turbo | Fast, cheap, already integrated |
| Knowledge compilation | LLM-wiki pattern (Karpathy) | Compiled knowledge > raw retrieval for consistency |

---

## What NOT to Change

- **Pipeline DAG system** — the 15-step executor pattern works. We add per-chapter pipelines, not replace the pipeline system.
- **Step executor interface** — `StepExecutor` with `inputs/outputs/execute` is solid. New steps (if any) follow the same pattern.
- **Rivet actor pattern** — 4 actors + 2 new ones (Chapter, KnowledgeBase). Same Effect + @rivetkit/effect pattern.
- **SSE event system** — existing broadcast → SSE bridge works. Add chapter-level events.
- **shadcn/ui** — keep the current design system. Add new components for chapters/knowledge.
- **DB repository pattern** — `EntityRepo<TDomain, TRow>` generic CRUD works. Add new entity repos for chapters, characterStates, knowledgePages.
- **Provider abstraction** — adapter factory pattern in packages/ai works. Add embedding adapter.

---

## Appendix: File Change Summary

### New Files
```
packages/storage/src/types.ts
packages/storage/src/s3.ts
packages/storage/src/local.ts
packages/storage/src/factory.ts
packages/storage/src/index.ts
packages/storage/package.json

packages/knowledge/src/types.ts
packages/knowledge/src/embeddings.ts
packages/knowledge/src/chunking.ts
packages/knowledge/src/ingest.ts
packages/knowledge/src/rag.ts
packages/knowledge/src/tools.ts
packages/knowledge/src/wiki.ts
packages/knowledge/src/wiki-ingestor.ts
packages/knowledge/src/index.ts
packages/knowledge/package.json

packages/actors/src/actors/chapter/api.ts
packages/actors/src/actors/chapter/live.ts
packages/actors/src/actors/knowledge-base/api.ts
packages/actors/src/actors/knowledge-base/live.ts
packages/actors/src/agents/story-planner.ts
packages/actors/src/agents/bible-builder.ts

packages/db/migrations/0001_chapters_and_knowledge.sql

apps/web/src/app/api/chapters/route.ts
apps/web/src/app/api/chapters/[id]/upload/route.ts
apps/web/src/app/api/chapters/[id]/transcription/route.ts
apps/web/src/app/api/chapters/[id]/transcribe/route.ts
apps/web/src/app/api/chapters/[id]/status/route.ts
apps/web/src/app/api/projects/[id]/chapters/route.ts
apps/web/src/app/api/projects/[id]/knowledge/route.ts
apps/web/src/app/api/projects/[id]/bible/route.ts
apps/web/src/app/api/projects/[id]/characters/[charId]/timeline/route.ts

apps/web/src/components/ChapterCard.tsx
apps/web/src/components/ChapterUploadModal.tsx
apps/web/src/components/KnowledgeBrowser.tsx
apps/web/src/components/CharacterTimeline.tsx
apps/web/src/components/WikiPageViewer.tsx

docker-compose.yml
```

### Modified Files
```
packages/domain/src/schema.ts          — Chapter, CharacterState, KnowledgePage schemas
packages/db/src/schema.ts              — chapters, character_states, knowledge_pages tables
packages/db/src/repo.ts                — new entity repos
packages/actors/src/actors/file-registry/live.ts  — MediaManager instead of Storage
packages/actors/src/actors/bible/api.ts           — temporal tracking actions
packages/actors/src/actors/bible/live.ts          — temporal state, wiki, merge
packages/actors/src/actors/project/api.ts         — chapter management actions
packages/actors/src/actors/project/live.ts        — chapter list, reorder
packages/actors/src/actors/pipeline/steps/plan_story.ts     — Mastra agent
packages/actors/src/actors/pipeline/steps/build_bibles.ts   — Mastra agent
packages/actors/src/actors/pipeline/steps/section_memory.ts — real embeddings
packages/actors/src/lib/pipeline-bridge.ts        — MediaManager, knowledge base, agents
packages/actors/src/server/main.ts               — register new actors
packages/actors/src/index.ts                     — export new actor contracts

apps/web/src/lib/actor-actions.ts     — chapter + knowledge base actions
apps/web/src/lib/storage.ts           — delegate to packages/storage/
apps/web/src/components/ProjectDetail.tsx  — 5 tabs (add Chapters + Knowledge)
apps/web/src/components/NewProjectForm.tsx — remove inline upload (chapters handle it)
apps/web/src/app/api/assets/[...key]/route.ts — stream from MediaManager

.env                                  — S3 config vars
package.json                          — @mastra/core, @mastra/rag, @mastra/pg, @aws-sdk/client-s3
```
