# Ticket 01: Panel/Page CRUD API Routes

## Status: TODO

## Description

Create REST API endpoints for CRUD operations on panels and pages. The canvas UI needs these to persist user edits (panel position, prompt, dialogue, bubble positions).

## Tasks

- [ ] `GET /api/projects/[id]/pages` — list all pages with their panels (joined)
- [ ] `GET /api/projects/[id]/pages/[pageId]` — single page with full panel + lettering data
- [ ] `PATCH /api/panels/[id]` — update panel fields: description, renderPrompt, renderNegativePrompt, cameraFraming, dialogueLines, characters, qaStatus, qaNotes, seed
- [ ] `PATCH /api/panels/[id]/bbox` — update panel bbox {x, y, w, h} on canvas
- [ ] `POST /api/panels/[id]/regenerate` — trigger panel re-render (creates job, stub during dev)
- [ ] `GET /api/pages/[id]/lettering` — get lettering boxes for a page
- [ ] `PATCH /api/lettering/[id]` — update bubble position/text
- [ ] `POST /api/pages/[id]/lettering` — add new bubble
- [ ] `DELETE /api/lettering/[id]` — remove bubble
- [ ] `PATCH /api/pages/[id]/reorder` — update readingOrder + page index

## Dependencies

- Existing `packages/db/src/repo.ts` has `EntityRepo` pattern. Add panel/page/lettering repos or extend existing.
- Existing `packages/db/src/schema.ts` has `panelSpecs`, `pageSpecs`, `letteringSpecs` tables.

## Acceptance Criteria

- All endpoints return JSON, handle errors with try/catch
- PATCH endpoints accept partial updates (only provided fields are updated)
- bbox endpoint validates 0-1 normalized range
- regenerate endpoint creates a job record but does NOT call image API (stub returns job ID)
