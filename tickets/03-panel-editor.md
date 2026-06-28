# Ticket 03: Panel Editor Sidebar

## Status: TODO

## Description

Slide-out sidebar that appears when a panel is selected on the canvas. Allows editing all panel properties and triggering regeneration.

## Layout

Right sidebar, ~400px wide, slides in from right when a panel is selected.

## Sections

### 1. Panel Info
- Panel index, page number
- QA status badge (pending/passed/failed/regenerate)

### 2. Visual Description
- Textarea: `description` (what the panel shows)
- Select: `cameraFraming` (wide, medium, close-up, etc.)

### 3. Render Prompt
- Textarea: `renderPrompt` (the prompt sent to image generator)
- Textarea: `renderNegativePrompt`
- Input: `seed` (number)
- Button: "Regenerate Panel" (calls POST /api/panels/[id]/regenerate)
  - Shows loading state
  - Does NOT call image API during dev (stub)

### 4. Characters
- List of characters in panel, each with:
  - Character name (from CharacterProfile)
  - Pose (text input)
  - Expression (text input)
  - Position (select: left/center/right/background)
- Add character button

### 5. Dialogue
- List of dialogue lines, each with:
  - Speaker (text input)
  - Text (textarea)
  - Type (select: speech/thought/narration/sfx)
- Add dialogue line button
- Remove line button per line

## Data Flow

```
User edits field in sidebar
  → Local state update (debounced)
  → PATCH /api/panels/[id] { field: value }
  → Optimistic UI update
```

## Files

- `apps/web/src/components/canvas/PanelEditor.tsx`
- `apps/web/src/components/canvas/DialogueEditor.tsx` (sub-component)
- `apps/web/src/components/canvas/CharacterEditor.tsx` (sub-component)

## Dependencies

- Ticket 01 (PATCH /api/panels/[id])
- Ticket 02 (canvas selection state)

## Acceptance Criteria

- Sidebar opens when panel selected, closes on deselect
- All fields are editable and debounce-save to API
- Regenerate button shows loading state
- Character and dialogue lists support add/remove
- Form is scrollable when content exceeds viewport
