# Ticket 02: Comic Canvas Component

## Status: TODO

## Description

Build the core canvas component using React Flow. This replaces the static ArtifactsTab grid with an interactive, infinite canvas where comic pages and panels are visual objects.

## Design

- React Flow (`@xyflow/react`) — already a dependency, used in PipelineFlow
- Each page is a React Flow node (custom type `comicPage`)
- Inside each page node, panels are rendered as absolutely-positioned divs using `bbox` (normalized 0-1 → pixel coordinates within the page node's dimensions)
- Page node has a fixed aspect ratio (e.g., 800x1200px for a comic page)
- Panels show their rendered image (from `PanelRenderResult.imageKey`) or a placeholder
- Panels are draggable within the page bounds (updates bbox)
- Panels are resizable via corner handles (updates bbox)
- Click a panel to select it → opens PanelEditor sidebar
- Zoom/pan with React Flow controls
- Multiple pages laid out horizontally on the canvas

## Interactions

- **Select mode** (default): click panel to select, drag to move
- **Resize**: drag corner handles when selected
- **Multi-select**: shift-click (future)
- **Context menu**: right-click panel for quick actions (regenerate, duplicate, delete)

## State

- Zustand store: `useCanvasStore`
  - `selectedPanelId: string | null`
  - `selectedPageId: string | null`
  - `mode: 'select' | 'move' | 'bubble'`
  - `zoom: number`

## Files

- `apps/web/src/components/canvas/ComicCanvas.tsx` — main canvas
- `apps/web/src/components/canvas/PageNode.tsx` — React Flow custom node for a page
- `apps/web/src/components/canvas/PanelBlock.tsx` — panel within a page (draggable, resizable)
- `apps/web/src/stores/canvas-store.ts` — Zustand store

## Dependencies

- Ticket 01 (API routes for fetching/saving panel data)
- `@xyflow/react` (already installed)
- `zustand` (needs install)
- `@dnd-kit/core` (optional, for panel reordering — React Flow handles drag)

## Acceptance Criteria

- Canvas renders pages with panels positioned by bbox
- Panels are draggable and update bbox on drop
- Panels are resizable via corner handles
- Selected panel highlights with border
- Zoom/pan works with React Flow controls
- Empty state when no pages exist
