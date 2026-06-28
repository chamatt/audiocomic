# Ticket 06: Integrate Canvas into ProjectDetail

## Status: TODO

## Description

Replace the static ArtifactsTab with the new ComicCanvas. Restructure ProjectDetail tabs to make the canvas the primary creative workspace.

## New Tab Structure

### Tab 1: Canvas (NEW — primary workspace)
- Full-height ComicCanvas component
- CanvasToolbar at top
- PanelEditor sidebar (slides in on panel select)
- PageThumbnailBar at bottom
- This is the default tab when a project has generated pages

### Tab 2: Chapters (unchanged)
- Chapter list, upload, transcription

### Tab 3: Pipeline (unchanged)
- PipelineFlow DAG, step controls

### Tab 4: Knowledge (unchanged)
- Characters, world bible, wiki

### Tab 5: Settings (unchanged)
- Project info, provider settings

## Changes

- Remove `ArtifactsTab` function from ProjectDetail.tsx
- Add `CanvasTab` that renders ComicCanvas + toolbar + sidebar + thumbnails
- Default tab changes from "pipeline" to "canvas" when pages exist, "chapters" when no pages
- Canvas tab shows empty state with "Run the pipeline to generate pages" when no pages

## Files

- `apps/web/src/components/ProjectDetail.tsx` — restructure tabs
- `apps/web/src/components/canvas/CanvasTab.tsx` — wrapper component

## Dependencies

- Tickets 02, 03, 04, 05 (all canvas components)

## Acceptance Criteria

- Canvas tab is the first tab
- Canvas renders full-height (no extra padding)
- PanelEditor slides in/out without layout shift
- Other tabs remain functional
- Default tab selection logic works
