# AudioComic Production Architecture Plan

## Vision

A real production tool where users upload audiobooks, the system transcribes and
structures them into chapters and issues, and the user generates comic panels
one at a time or page by page — with full control to regenerate, reorder, adjust
speech bubbles, and export each issue separately.

## Current State (2026-06-28)

- Rivet actor system with 4 actors: FileRegistry, Bible, Project, Pipeline
- 15 step executors wired to real adapters (@audiocomic/ai, @audiocomic/renderers, @audiocomic/media)
- Pipeline runs all 15 stages in sequence: normalize → transcribe → segment → plan_story →
  build_bibles → section_memory → plan_pages → validate_layout → compose_prompts →
  render_panels → panel_qa → compose_pages → lettering → export_static → export_motion
- Web UI with project list, project detail (pipeline controls), settings
- DB persistence via @audiocomic/db (Drizzle + Postgres)
- File storage via local filesystem (uploads/)

## Target Architecture

### New Domain Concepts

#### Workspace
A user's local file storage area. Files uploaded here are reusable across projects.
- Upload audio files (mp3, m4b, wav)
- Upload text files
- Files are tagged, searchable, previewable
- **Actor**: FileRegistry (exists) — extend with upload, delete, tag management

#### Project
A comic adaptation of a source (audiobook or text).
- Has a bible (characters, world, lore)
- Has multiple pipelines (one per chapter/issue)
- Shares the bible across all pipelines
- **Actor**: Project (exists) — extend with chapter/issue management

#### Chapter
A segment of an audiobook. Audiobooks are large (10-30 hours); chapters make
them manageable. Each chapter becomes one or more issues.
- Created by splitting the source audio (ffmpeg chapter detection or manual split)
- Has its own pipeline run
- Belongs to a project
- **New**: ChapterActor — manages chapter state, splitting, pipeline association

#### Issue
A comic issue = one publishable unit (like a comic book issue). A chapter may
produce multiple issues if it's too long for a single comic.
- Contains pages (typically 4-8 pages per issue)
- Has its own pipeline run (subset of the full pipeline)
- Can be exported independently (PDF, CBZ, MP4)
- **New**: IssueActor — manages issue state, page generation, export

#### Page
A single comic page = composition of panels.
- Can be generated one at a time
- Can be regenerated independently
- Panels can be reordered within a page
- Speech bubbles can be moved/edited
- **Actor**: Extend PipelineActor with per-page generation actions

#### Panel
A single comic panel = one rendered image with dialogue.
- Can be generated one at a time
- Can be regenerated with additional instructions
- Can be moved between pages
- Has QA status (passed/failed/pending)
- **Actor**: Extend PipelineActor with per-panel actions

### Actor System Design

```
FileRegistry (exists)
  - upload file → returns metadata
  - list/search files by tag, project
  - delete file
  - transcode audio (ffmpeg)

Project (exists, extend)
  - create chapter from audio file + timestamps
  - list chapters
  - link bible
  - create issue from chapter

Bible (exists, extend)
  - add/edit/remove characters
  - add/edit/remove world lore
  - add/edit/remove scene profiles
  - shared across all issues in a project

ChapterActor (new)
  - split audio into segments (ffmpeg)
  - create issues from segments
  - run pipeline on a segment
  - state: segments, issue IDs, pipeline status

IssueActor (new)
  - run enrichment pipeline (plan_story → plan_pages → compose_prompts)
  - generate panel one at a time
  - generate page one at a time
  - regenerate panel with additional instructions
  - move speech bubbles (lettering edit)
  - reorder panels within page
  - export issue (PDF, CBZ, MP4)
  - state: pages, panels, generation progress, export status

PipelineActor (exists, extend)
  - run full pipeline (existing 15 steps)
  - run partial pipeline (from any step)
  - run single step
  - run per-panel generation
  - run per-page composition
  - pause/resume/retry/skip (exists)
```

### Pipeline Modes

The current pipeline runs all 15 steps in one shot. Production needs granular control:

1. **Full pipeline** (existing): All 15 steps, start to finish
2. **Chapter pipeline**: normalize → transcribe → segment → plan_story → build_bibles
3. **Issue pipeline**: plan_pages → validate_layout → compose_prompts → render_panels → panel_qa → compose_pages → lettering → export
4. **Single panel generation**: compose_prompts → render_panels (for one panel)
5. **Single page composition**: compose_pages (for one page)
6. **Lettering edit**: lettering (for one page, with user-adjusted bubble positions)
7. **Export only**: export_static and/or export_motion (for one issue)

### UI Screens

#### Workspace / File Library
- Upload files (drag & drop)
- File list with tags, duration, preview
- Search/filter
- "Add to project" action

#### Project List
- Cards with project name, description, progress
- "New project" button
- Click → project detail

#### Project Detail
- Bible editor (characters, world, lore)
- Chapter list (from source audio)
- Issue list per chapter
- Pipeline controls (existing)
- Source file management

#### Chapter View
- Audio player with waveform
- Chapter segments (split points)
- "Create issue from segment" action
- "Run pipeline on segment" action

#### Issue Editor (the main production screen)
- Page thumbnails strip (left sidebar)
- Page canvas (center) — shows composed page with panels
- Panel list (right sidebar) — per-panel controls
- Per-panel: regenerate with instructions, move, delete
- Per-page: generate, regenerate, compose, export
- Speech bubble editor — drag bubbles, edit text
- Export buttons (PDF, CBZ, MP4 for this issue)

#### Panel Editor (modal or inline)
- Rendered image preview
- Prompt editor (with "regenerate" button)
- Additional instructions field
- Seed control (lock seed for consistency)
- QA status toggle
- Character reference images

### Data Model Changes

New tables:
- `chapters` — id, project_id, source_asset_id, title, start_sec, end_sec, issue_count
- `issues` — id, chapter_id, project_id, title, page_count, export_status, created_at
- `panel_edits` — id, panel_id, user_instructions, seed_override, created_at
- `lettering_edits` — id, page_id, box_id, bbox_override, text_override, created_at

Modified tables:
- `pages` — add `issue_id` column
- `panels` — add `issue_id` column, add `user_instructions` column
- `projects` — add `source_asset_id` column (direct link to uploaded file)

### Implementation Phases

#### Phase 1: Chapter Splitting + Issue Management (next)
- Add `chapters` and `issues` tables to @audiocomic/db
- Create ChapterActor (split audio, create issues)
- Create IssueActor (per-issue pipeline runs)
- Add chapter/issue UI to project detail
- Wire ffmpeg chapter detection to FileRegistry

#### Phase 2: Granular Panel/Page Generation
- Extend PipelineActor with `GeneratePanel`, `GeneratePage`, `RegeneratePanel` actions
- Add panel editor UI (prompt, instructions, seed, regenerate)
- Add page composition UI (one page at a time)
- Wire to existing render_panels and compose_pages executors

#### Phase 3: Lettering Editor
- Add lettering edit UI (drag speech bubbles, edit text)
- Extend IssueActor with `UpdateLettering` action
- Wire to existing lettering executor with user-adjusted positions
- Real-time SVG preview

#### Phase 4: Export Per Issue
- Extend IssueActor with `ExportIssue` action (PDF, CBZ, MP4)
- Export UI per issue
- Background export with progress tracking
- Download links

#### Phase 5: Polish
- Audio player with waveform for chapter splitting
- Drag-and-drop panel reordering within pages
- Panel-to-page move
- Undo/redo
- Keyboard shortcuts
- Batch operations (regenerate all failed panels, export all issues)

### Key Technical Decisions

1. **Actors as the pipeline orchestrator**: The monolithic FullPipelineHandler
   is replaced. Each step is an independent actor executor that can run alone
   or as part of a sequence. This enables per-panel, per-page, per-issue generation.

2. **Chapter → Issue hierarchy**: Audiobooks are too large for one pipeline run.
   Chapters split the source into manageable segments. Issues split chapters into
   publishable comic units. Each issue has its own pipeline run.

3. **Bible sharing**: One bible per project, shared across all issues. Characters
   and world lore are defined once and referenced by all issues.

4. **Per-panel regeneration**: Users can regenerate any panel with additional
   instructions. The panel executor calls the renderer with the new prompt +
   seed. Previous results are kept for comparison.

5. **Lettering as editable layer**: Speech bubbles are SVG overlays, not baked
   into the page image. Users can drag them, edit text, and re-export without
   re-rendering panels.

6. **Export per issue**: Each issue exports independently. The export executor
   takes an issue ID and produces PDF/CBZ/MP4 for just that issue's pages.

### File Structure (new files)

```
packages/actors/src/actors/
  chapter/
    api.ts          — ChapterActor contract
    live.ts         — split, create issues, run pipeline
  issue/
    api.ts          — IssueActor contract
    live.ts         — per-issue pipeline, panel/page gen, export
packages/actors/src/actors/pipeline/steps/
  generate_panel.ts  — single panel generation
  generate_page.ts   — single page composition
  export_issue.ts    — per-issue export
packages/db/src/schema.ts (modify)
  + chapters table
  + issues table
  + panel_edits table
  + lettering_edits table
apps/web/src/app/
  projects/[id]/chapters/page.tsx
  projects/[id]/chapters/[cid]/page.tsx
  projects/[id]/issues/[iid]/page.tsx  — the main editor
apps/web/src/components/
  ChapterList.tsx
  IssueEditor.tsx
  PanelEditor.tsx
  LetteringEditor.tsx
  PageThumbnail.tsx
  AudioWaveform.tsx
```
