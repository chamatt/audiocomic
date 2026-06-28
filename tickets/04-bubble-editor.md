# Ticket 04: Speech Bubble Editor

## Status: TODO

## Description

Overlay system for positioning and editing speech bubbles on top of rendered panel images. Bubbles are draggable and editable directly on the canvas.

## Design

- When mode is "bubble", panels show dialogue bubbles as overlay divs
- Each bubble is positioned via `LetteringBox.bbox` (normalized 0-1 relative to panel)
- Bubble types have different visual styles:
  - `speech`: rounded white bubble with tail
  - `thought`: cloud-shaped bubble
  - `narration`: yellow rectangle caption
  - `sfx`: bold text with burst shape
- Bubbles are draggable within panel bounds
- Double-click bubble to edit text inline
- Click bubble to select → shows delete handle
- Add bubble: click empty area of panel in bubble mode

## Interactions

- **Drag bubble**: updates bbox, debounced save to API
- **Double-click**: enters text edit mode (contenteditable or textarea overlay)
- **Click**: selects bubble, shows delete (X) button
- **Click empty panel area**: opens "add bubble" menu (choose type)

## Visual Style

Bubbles rendered with CSS:
- Speech: `bg-white text-black rounded-2xl px-3 py-2 border-2 border-black shadow`
- Thought: `bg-white text-black rounded-full px-3 py-2 border-2 border-dashed border-black`
- Narration: `bg-yellow-100 text-black px-3 py-2 border-2 border-black font-medium`
- SFX: `bg-white text-red-600 font-bold text-xl px-3 py-2 border-2 border-red-600`

## Files

- `apps/web/src/components/canvas/BubbleEditor.tsx`
- `apps/web/src/components/canvas/Bubble.tsx` (individual bubble)

## Dependencies

- Ticket 01 (lettering API routes)
- Ticket 02 (canvas + panel rendering)

## Acceptance Criteria

- Bubbles render on top of panel images
- Bubbles are draggable and update position
- Double-click edits text inline
- Add/remove bubbles works
- Bubble types have distinct visual styles
- Mode toggle between "select" and "bubble" in toolbar
