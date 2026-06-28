# MangaFlow Alignment Plan — Mastra Workflow Improvements

> Reference: MangaFlow paper (arXiv:2605.28173v1), Algorithm 1, Section 3.4–3.7
> Status: in-progress, 2026-06-28

## Current State

The 3-pass Mastra planner (pass 1: story+KB tools → chapters/scenes, pass 2: beats, pass 3: panel hints) is working and produces 10 beats → 4 pages → 10 panels for chapter 1. However, the panel prompt composition step does not fully implement MangaFlow's section memory or layout-conditioned prompting.

## Gaps vs. MangaFlow Algorithm 1

### Gap 1: Section Memory not built or passed (C1)

**Paper**: For each story section `s_k`, build memory `M_k = (d_k, R_scene_k, R_char_k, R_obj_k, φ_k)`. Panel prompt = `A_panel(y_ij, L̃_i, M_z(i,j))`.

**Current**: `composePanelPrompt` accepts an optional `sectionMemory?: string` but no call site passes it. The function only sees the beat-level section — it doesn't traverse parent scene/chapter for accumulated context.

**Fix**:
- Add `buildSectionMemory(beat: StorySection, allSections: StorySection[], characters: CharacterProfile[], worldBible: WorldBible): string` to `packages/ai/src/prompt.ts`
- It traverses `beat → parent scene → parent chapter`, concatenating summaries, emotional tones, characters present, and objects
- Includes character descriptions from the world bible for recurring characters
- Wire it into all 3 call sites: `compose_prompts.ts`, `plan_chapters.ts`, `chapter/live.ts`

### Gap 2: Layout context not in panel prompt (C2)

**Paper**: Panel prompt includes `L̃_i` (validated page layout). The renderer knows panel dimensions from the layout.

**Current**: `composePanelPrompt` receives no layout info. Panel `bbox` exists on `PanelSpec` but is not passed to the prompt composer.

**Fix**:
- Pass panel `bbox` (width/height ratio) into the prompt as composition guidance
- Add aspect ratio hint: "wide panel" / "tall panel" / "square panel" based on bbox dimensions
- This helps the renderer frame the shot correctly

### Gap 3: Objects never populated (C1)

**Paper**: Each section `s_k = (d_k, e_k, C_k, O_k)` includes key objects `O_k`. These are part of section memory and reused across panels.

**Current**: `StorySection.objects` field exists (default `[]`) but the 3-pass planner never populates it. The `pass2Schema` in `agents/index.ts` has `objects` on beats but they're not mapped into the `StorySection`.

**Fix**:
- In `makeStoryPlannerHandle`, pass 2 beat→section mapping: set `objects: beat.objects ?? []`
- In `composePanelPrompt`, include section objects in the prompt: "Key objects: sword, amulet, door"

### Gap 4: Character visual references not in prompt (C3)

**Paper**: `R_char_k` denotes character reference images. The prompt includes visual anchors.

**Current**: `composePanelPrompt` includes character descriptions and palette notes but not `canonicalFaceRef` or `outfitRefs`. These are stored on `CharacterProfile` but not used.

**Fix**:
- If `canonicalFaceRef` exists, include a reference image instruction in the prompt
- If `outfitRefs` exist, include outfit reference instructions
- This enables IP-Adapter / reference-image conditioning on the renderer side

## Implementation Order

1. **`buildSectionMemory` helper** — pure function in `packages/ai/src/prompt.ts`
2. **Enrich `composePanelPrompt`** — accept `allSections` param, call `buildSectionMemory` internally, add layout/object/character-ref context
3. **Wire call sites** — update `compose_prompts.ts`, `plan_chapters.ts`, `chapter/live.ts` to pass `allSections`
4. **Populate objects** — fix beat→section mapping in `agents/index.ts` pass 2
5. **Export from `@audiocomic/ai`** — add `buildSectionMemory` to index.ts exports
6. **Typecheck + test** — reset chapter, re-plan, verify prompts include section memory

## Non-Goals (this iteration)

- IP-Adapter / ControlNet wiring (renderer-side, separate effort)
- Layout self-reflection loop (paper's ablation shows 0.86% → 0.62% overlap improvement — marginal)
- Lettering face-occlusion avoidance (already have separate lettering pass)
- Timing/narration sync (separate pipeline step)
