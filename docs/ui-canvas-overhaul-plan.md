# UI Canvas Overhaul Plan

## Goal

Transform AudioComic from a pipeline-monitoring dashboard into a real production comic editor. Users need a canvas-based workspace where they can see generated pages, rearrange panels, edit prompts per-panel, regenerate individual panels, move speech bubbles, and control the creative output granularly.

## Design Read

Reading this as: **production creative tool** for audiobook-to-comic creators, with a **dark, focused workspace** language, leaning toward shadcn/ui (already in use) + React Flow canvas + dnd-kit for panel manipulation. Not a marketing page. Not a dashboard. A creative editor like Figma/Excalidraw meets a comic page builder.

## Current State

- **ProjectDetail.tsx** (1179 lines): 5 tabs (Chapters, Pipeline, Knowledge, Artifacts, Settings)
- **ArtifactsTab**: Static grid of panel cards with "Regenerate" button. No canvas. No drag. No prompt editing. No bubble positioning.
- **PipelineFlow.tsx**: Uses @xyflow/react for pipeline step DAG. Good foundation.
- **Domain types**: PanelSpec has `bbox` (normalized 0-1), `renderPrompt`, `dialogueLines`, `characters`, `cameraFraming`. PageSpec has `panelIds`, `readingOrder`. LetteringBox has position. All the data models exist.
- **DB tables**: `panel_specs`, `page_specs`, `panel_render_results`, `page_composites`, `lettering_specs` all exist.
- **No panel/page API routes**: No REST endpoints for CRUD on panels/pages.
- **No canvas component**: No interactive page layout editor.

## Architecture

### New Components

1. **ComicCanvas** (`components/canvas/ComicCanvas.tsx`)
   - React Flow-based infinite canvas
   - Renders pages as nodes containing panel images positioned by `bbox`
   - Panels are draggable, resizable
   - Click panel to select → opens PanelEditor sidebar
   - Zoom/pan with React Flow controls
   - Multiple pages shown as separate flow nodes

2. **PanelEditor** (`components/canvas/PanelEditor.tsx`)
   - Slide-out sidebar (right side) when a panel is selected
   - Edit: description, renderPrompt, cameraFraming, characters, dialogueLines
   - Regenerate button (calls render API, NO image gen during dev)
   - QA status toggle
   - Seed control

3. **BubbleEditor** (`components/canvas/BubbleEditor.tsx`)
   - Overlay on panel images for dialogue bubbles
   - Drag to reposition bubbles (updates LetteringBox positions)
   - Click bubble to edit text
   - Add/remove bubbles
   - Bubble types: speech, thought, narration, sfx

4. **PageThumbnailBar** (`components/canvas/PageThumbnailBar.tsx`)
   - Bottom strip showing page thumbnails
   - Click to navigate to page on canvas
   - Reorder pages via drag

5. **CanvasToolbar** (`components/canvas/CanvasToolbar.tsx`)
   - Top toolbar: zoom controls, page nav, add page, export
   - Mode toggle: Select / Move / Bubble edit

### New API Routes

- `GET /api/projects/[id]/pages` - list pages with panels
- `GET /api/projects/[id]/pages/[pageId]` - single page with full panel data
- `PATCH /api/panels/[id]` - update panel (description, prompt, bbox, dialogue)
- `POST /api/panels/[id]/regenerate` - trigger re-render (stub during dev, no image API)
- `PATCH /api/panels/[id]/bbox` - update panel position/size on canvas
- `GET /api/pages/[id]/lettering` - get lettering boxes for a page
- `PATCH /api/lettering/[id]` - update bubble position/text
- `POST /api/pages/[id]/lettering` - add new bubble
- `DELETE /api/lettering/[id]` - remove bubble
- `PATCH /api/pages/[id]/reorder` - reorder pages

### Data Flow

```
User drags panel on canvas
  → PATCH /api/panels/[id]/bbox { bbox: {x,y,w,h} }
  → DB update
  → Canvas reflects new position (optimistic)

User edits prompt in PanelEditor
  → PATCH /api/panels/[id] { renderPrompt: "..." }
  → DB update
  → User clicks "Regenerate"
  → POST /api/panels/[id]/regenerate
  → Actor triggers render step (stub: returns placeholder)
  → Panel shows loading state
  → When result arrives, panel image updates
```

### State Management

- **Zustand store** for canvas state (selected panel, selected page, zoom, mode)
- React Query or SWR for data fetching (pages, panels, lettering)
- Optimistic updates for drag operations

## Tickets

See `tickets/` directory for detailed breakdown.

## Constraints

- NO image generation API calls during development (user will test together)
- CAN use Groq (transcription) and LLM (OpenRouter) for text operations
- Must work with existing shadcn/ui components
- Must preserve existing pipeline/chapters/knowledge tabs
- Dark theme (already established)
