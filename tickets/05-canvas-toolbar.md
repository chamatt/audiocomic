# Ticket 05: Canvas Toolbar & Page Navigation

## Status: TODO

## Description

Top toolbar for the canvas view and bottom thumbnail strip for page navigation.

## Toolbar (Top)

- **Mode toggle**: Select / Move / Bubble (segmented control)
- **Zoom controls**: zoom in, zoom out, fit to view, 100%
- **Page navigation**: prev/next page buttons, current page indicator
- **Add page**: button to create a new blank page
- **Export**: dropdown (Export Pages ZIP, Export PDF, Export MP4)

## Page Thumbnail Bar (Bottom)

- Horizontal strip of page thumbnails (composite images or panel layout preview)
- Click thumbnail to navigate canvas to that page
- Drag thumbnails to reorder pages (updates page index + readingOrder)
- Current page highlighted with border
- Scrollable if many pages

## Files

- `apps/web/src/components/canvas/CanvasToolbar.tsx`
- `apps/web/src/components/canvas/PageThumbnailBar.tsx`

## Dependencies

- Ticket 02 (canvas component)
- `@dnd-kit/sortable` for thumbnail reordering (needs install)

## Acceptance Criteria

- Toolbar mode toggle switches canvas interaction mode
- Zoom controls work (delegates to React Flow)
- Page navigation works (scrolls canvas to selected page)
- Thumbnail bar shows all pages
- Thumbnail drag reorders pages and persists to API
- Add page creates a new page via API and navigates to it
