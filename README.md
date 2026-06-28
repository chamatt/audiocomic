# AudioComic — Audiobook to Narrated Comic

Convert audiobooks and books into narrated comic books and motion comics using a structured, research-backed pipeline.

## Architecture

AudioComic is a **hybrid agentic + deterministic media pipeline**. LLM agents handle planning, decomposition, and validation; deterministic services handle transcription, layout checks, rendering, page assembly, and video export. This design follows the [MangaFlow](https://arxiv.org/abs/2502.18043) methodology: explicit, editable intermediate variables (story plans, page specs, panel specs, render prompts) rather than opaque end-to-end generation.

### Five planes

1. **Ingestion** — Audio is transcribed with word-level timestamps (OpenAI Whisper). Text is parsed into chapters/paragraphs. Both produce a normalized timeline.
2. **Story Intelligence** — An LLM decomposes the source into chapters → scenes → beats, builds world/character bibles, and plans pages + panels as typed JSON (Zod-validated).
3. **Memory & Retrieval** — Postgres + pgvector store section memory, character embeddings, and visual references for cross-panel consistency.
4. **Rendering** — An adapter interface targets ComfyUI (open models), AI SDK (hosted), or a placeholder backend. Panel-level generation with reference conditioning.
5. **Export** — FFmpeg assembles narrated motion-comic MP4s with Ken Burns zoom/pan, synchronized to the original audio timeline.

### Pipeline stages

```
normalize → transcribe → segment → plan_story → build_bibles → section_memory
→ plan_pages → validate_layout → compose_prompts → render_panels → panel_qa
→ compose_pages → lettering → export_static → export_motion
```

Every stage is persisted, replayable, and individually re-runnable. Panel regeneration doesn't recompute the whole project.

## Repository structure

```
apps/web              Next.js app — project UI, upload, storyboard, export
packages/domain       Zod schemas for all entities (Project, PageSpec, PanelSpec, ...)
packages/shared       Env config, feature flags, provider defaults, storage helpers
packages/db           Drizzle ORM schema, pgvector migrations, repository layer
packages/ai           AI SDK adapters — transcription, story planner, TTS, image generation
packages/renderers    Renderer adapters — ComfyUI, AI SDK, placeholder
packages/media        FFmpeg motion-comic, audio/text ingestion, lettering, page compositor
packages/workflows    Durable job engine, pipeline orchestration, worker, seed
packages/evals        Evaluation metrics (layout adherence, consistency, timing drift)
```

## Quick start

### Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [Docker](https://www.docker.com/) (for local Postgres + pgvector)
- [FFmpeg](https://ffmpeg.org/) (for motion-comic export)
- An AI provider API key (OpenAI recommended for full pipeline)

### Setup

```bash
# 1. Install dependencies
bun install

# 2. Start Postgres + pgvector via Docker
bun run db:up

# 3. Configure environment
cp .env.example .env
# Edit .env — set at least OPENAI_API_KEY (DATABASE_URL already matches docker)

# 4. Run database migrations
bun run db:push

# 5. Start the web app
bun run dev

# 6. In another terminal, start the worker
bun run worker

# 7. (Optional) Seed a demo project
bun run seed
```

### Using the app

1. Open `http://localhost:3000`
2. Click **New Project** — upload an MP3 or paste book text
3. The pipeline runs automatically; watch progress on the project page
4. View the storyboard, inspect page/panel JSON, regenerate individual panels
5. Export as PNG page bundle or narrated MP4 motion comic

## Key design decisions

- **Panel-level generation over page-level**: The system never asks a model to generate a full finished page. It generates plans, prompts, and references as typed JSON, then composes pages deterministically.
- **Layout-first**: Page specs (panel count, bounding boxes, reading order) are generated and validated *before* any rendering. A deterministic validator checks bounds, overlap, coverage, and reading order.
- **Lettering is a separate layer**: Dialogue bubbles, narration boxes, and SFX are SVG overlays placed *after* page composition, not baked into panel art. This enables revision and localization.
- **Section memory**: Every panel references a `StorySection`. Character profiles store visual anchors (face/body/outfit references) for cross-panel consistency.
- **Provider-agnostic**: All model calls are behind adapters. Change providers in `.env` or the settings UI without touching domain code.
- **Durable execution**: Jobs persist in Postgres. The worker survives restarts without losing progress. Each stage is independently re-runnable.

## Configuration

See [`.env.example`](.env.example) for all options. Key settings:

| Setting | Default | Description |
|---|---|---|
| `DEFAULT_RENDERER` | `placeholder` | Rendering backend: `comfyui`, `aisdk`, or `placeholder` |
| `DEFAULT_LLM_MODEL` | `gpt-4o` | Model for story planning |
| `DEFAULT_IMAGE_MODEL` | `gpt-image-1-mini` | Model for panel rendering |
| `WORKER_CONCURRENCY` | `4` | Parallel job workers |
| `FEATURE_DIARIZATION` | `true` | Speaker diarization for audio input |
| `FEATURE_MOTION_COMIC` | `true` | MP4 export with Ken Burns motion |

## License

MIT
