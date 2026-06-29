# AudioComic — Prompt Generation & Pipeline Structure Backup

**Snapshot date:** 2026-06-29
**Branch:** `review/full-audit`
**Purpose:** Preserve the current prompt engineering and pipeline architecture in case of future regressions.

---

## Pipeline Stage Order

```
ingest_knowledge → build_bibles → generate_refs → plan_chapters → render_panels → panel_qa → compose_pages → lettering → export_static → export_motion
```

Each stage is an independent `StepExecutor` registered in `packages/actors/src/actors/pipeline/steps/`.

---

## 1. Story Planning — 3-Pass Decomposition

**File:** `packages/actors/src/agents/index.ts`

The story planner decomposes audiobook transcripts into a structured comic plan using three LLM passes:

### Pass 1: World + Characters + Chapters/Scenes (with KB tools)

**Agent:** `Story Planner` — uses Mastra tools for cross-chapter context retrieval.

**System prompt:**
```
You are a comic story planner. Decompose an audiobook chapter into a structured plan for adaptation into a narrated comic.

STEP 1: Use the available tools to gather cross-chapter context:
- Use vector-query to find relevant events and mentions from other chapters
- Use section-query to find structured story sections from previously planned chapters — this gives you chapter/scene/beat summaries, emotional tones, and character presence without re-reading raw transcripts
- Use character-lookup to get each character's current state and appearance
- Use character-timeline to check for outfit/state changes across chapters
- Use world-lookup to get the world setting, rules, and art style

STEP 2: Break the text into scenes. Each scene is a distinct narrative moment with its own location, time, and emotional tone. Include a verbatim textExcerpt (200-500 chars) from the source for each scene so later passes can extract beats and dialogue.

STEP 3: Identify all characters. For each character, provide:
- name: The character's name (use the most common name/alias)
- description: Physical appearance — be SPECIFIC and VISUAL. Include species, body type, clothing, colors, distinctive features. Example: "Tall incubus with dusky gray skin, short devil horns, long gray/black ponytail, barbed tail, black bat wings. Wears a tuxedo with wing-slit back." NOT "Incubus NPC."
- role: protagonist, antagonist, supporting, minor, or narrator
- isNew: true if this character appears for the first time in this chapter, false if they appeared in previous chapters

IMPORTANT: Do NOT duplicate characters. Each unique character should appear exactly once. If a character appears in multiple scenes, list them once with their most complete description.

STEP 4: Define the world setting and art style.
- setting: Describe the physical environment of this chapter
- artStyle: Be SPECIFIC about visual direction. Example: "Bold character silhouettes, cinematic wide establishing shots, comedic reaction panels with exaggerated expressions." NOT "comic art."
- tone: The emotional register of the chapter

Output: structured JSON with world setting, characters (with descriptions and roles), chapters (each containing scenes with summaries and text excerpts), and character states.
```

**Schema (pass1Schema):**
```typescript
{
  setting: string,           // Overall world/setting description
  genre: string[],           // Genre tags
  tone?: string,             // Emotional register
  artStyle?: string,         // Visual direction
  characters: [{
    name: string,
    aliases: string[],
    description: string,     // Physical appearance and personality
    role: string,            // protagonist, antagonist, supporting, minor, narrator
  }],
  chapters: [{
    title?: string,
    summary: string,
    scenes: [{
      title?: string,
      summary: string,       // Scene summary — a distinct narrative moment
      textExcerpt?: string,  // Verbatim source text for this scene
      emotionalTone: enum,   // neutral, tense, joyful, sad, angry, fearful, romantic, mysterious, epic, comedic, melancholic, hopeful
      charactersPresent: string[],
    }],
  }],
}
```

**Config:** `maxSteps: 15` (allows up to 15 tool calls for KB retrieval)

### Pass 2: Beat Decomposition (parallel, no tools)

**Agent:** `Beat Decomposer` — one call per scene, all scenes in parallel.

**System prompt:**
```
You are a comic beat breakdown assistant. Split the given scene into a sequence of narrative beats. Each beat is ONE visual moment that will become one or more comic panels.

Rules:
- Aim for 3-8 beats per scene. Fewer for slow scenes, more for action scenes.
- Each beat must have a CONCRETE visual summary — what the reader would SEE. Example: "Donut looks up at the starry ceiling, eyes wide" NOT "Donut reacts to the ceiling."
- Include the beat's text — a verbatim excerpt from the source that contains any dialogue or narration for this beat.
- Preserve the scene's emotional tone unless a beat clearly shifts it.
- Include a camera hint for each beat: wide, medium, close-up, extreme-close-up, overhead, low-angle, pov, or establishing.
- List characters present in each beat by name.
- List any notable objects that appear (weapons, items, UI elements).

Output: structured JSON with a beats array.
```

**Schema (pass2Schema):**
```typescript
{
  beats: [{
    summary: string,          // One visual moment — will become 1+ panels
    text?: string,            // Verbatim source text for this beat
    emotionalTone: enum,
    cameraHint?: enum,        // wide, medium, close-up, extreme-close-up, overhead, low-angle, pov, establishing
    charactersPresent: string[],
    objects: string[],
  }],
}
```

**Config:** `maxSteps: 3`

### Pass 3: Panel Layout (parallel, no tools)

**Agent:** `Panel Layout` — one call per beat group, all in parallel.

**System prompt:**
```
You are a comic layout planner. For each beat, propose exactly 1 panel that visualizes THAT beat.

CRITICAL RULES:
1. The panel description must describe the SAME event as the beat summary. Do not invent a different scene.
2. The description must be CONCRETE and VISUAL — describe what the reader SEES, not abstract narration.
   GOOD: "Carl stands in the golden hallway, looking up at the starry ceiling. His rock bounces off the ceiling, revealing it's an illusion. Donut sits on his shoulder, eyes wide."
   BAD: "A clear visual beat: the narrator frames Mordecai as non-combat, emphasizing NPC status."
3. Include SETTING details: location, lighting, atmosphere, time of day.
4. Include CHARACTER details: pose, expression, clothing, position in frame (left/center/right/background).
5. Extract DIALOGUE from the beat text — if a character speaks in the source text, include it as a dialogue line with the correct speaker.
6. Choose camera framing: wide (establishing shot), medium (conversation), close-up (emotion), extreme-close-up (detail), overhead, low-angle, pov, or establishing.
7. Match the beat's emotional tone in the visual composition.

For each beat:
1. Read the beat summary AND the beat text carefully
2. Write a visual description of THAT exact moment — what the reader sees
3. Specify which characters appear and their pose/expression
4. Add dialogue/narration lines if present in the beat text
5. Choose camera framing that fits the action

beatIndex must match the supplied beat list order (0-based).
```

**Schema (pass3Schema):**
```typescript
{
  panels: [{
    beatIndex: number,
    description: string,       // Visual description of the panel
    cameraFraming?: enum,
    characters: [{
      name: string,
      pose?: string,
      expression?: string,
      position?: enum,         // left, center, right, background
    }],
    dialogueLines: [{
      speaker: string,
      text: string,
      type: enum,              // speech, thought, narration, sfx
    }],
  }],
}
```

**Config:** `maxSteps: 3`

---

## 2. Agent Tools (KB Retrieval)

**File:** `packages/actors/src/agents/tools.ts`

Five Mastra tools available to Story Planner and Bible Builder agents:

| Tool | Purpose |
|------|---------|
| `vector-query` | Semantic search over chapter transcriptions (RAG) |
| `character-lookup` | Retrieve character profile + temporal state |
| `world-lookup` | Retrieve world bible + wiki pages |
| `character-timeline` | Track state changes (outfit, location, mood) across chapters |
| `section-query` | Retrieve structured story sections from previously planned chapters via embedding similarity |

---

## 3. Section Memory (MangaFlow M_k)

**File:** `packages/ai/src/prompt.ts` — `buildSectionMemory()`

Builds a compact context string by traversing the parent chain (beat → scene → chapter):

```
World: <world setting>
Chapter: <title> — <summary>
  tone: <emotional tone>
  characters: <names>
  objects: <objects>
Scene: <title> — <summary>
  tone: <emotional tone>
  characters: <names>
Beat: <summary>
  tone: <emotional tone>
  characters: <names>
  objects: <objects>
```

**Used for:** Embedding into `story_sections.embedding` for cross-chapter retrieval via `section-query` tool. Enriches planner context, NOT image prompts (causes multi-panel generation).

---

## 4. Panel Prompt Composition

**File:** `packages/ai/src/prompt.ts` — `composePanelPrompt()`

### Master Formula

```
A single illustration of one scene showing [Subject+Action], [Setting], [Style], [Technical].
```

Visual-first, comma-separated keywords. No narrative prose. Image models weight early tokens more heavily.

### Prompt Structure (ordered by token weight)

1. **Framing constraint** (always first): `"A single illustration of one scene showing"`
2. **Subject and action**: Character descriptions (physical, pose, expression, position, colors) + panel description (narrative prefixes stripped)
3. **Setting/background**: First sentence of world setting only (truncated to avoid multi-panel), plus scene objects
4. **Style modifiers**: Art style (panel-direction language stripped), color palette, visual tone cues
5. **Technical framing**: Camera label, aspect ratio (computed from bbox), speech bubble space reservation

### Key Design Decisions

- **Section memory intentionally omitted from image prompts** — describing multiple scenes/chapters causes the model to generate multi-panel pages. Continuity is handled by the planner agents, not the image renderer.
- **World setting truncated to first sentence** — long world descriptions make image models interpret them as instructions to show multiple scenes.
- **Art style cleaned** — strips `panel-to-panel`, `smooth panel`, `reaction-panel` phrases that cause multi-panel generation.
- **Speech bubble space** — when dialogue exists, adds `"leave empty space in upper area for speech bubbles, do not draw any text or letters"` to prevent the model from rendering literal text.
- **Narrative prefixes stripped** from panel description: regex removes `A clear visual beat:`, `The scene shows:`, `We see:` prefixes.

### Camera Labels

| CameraFraming | Label |
|---|---|
| wide | wide establishing shot showing the full environment |
| medium | medium shot framing the character(s) from the waist up |
| close-up | close-up shot focusing on the character's face and expression |
| extreme-close-up | extreme close-up on a specific detail (eyes, hand, object) |
| overhead | overhead top-down shot looking down at the scene |
| low-angle | low-angle shot looking up at the character(s), making them imposing |
| pov | first-person POV shot from a character's perspective |
| establishing | wide establishing shot showing the location and spatial layout |

### Emotional Tone → Visual Cue Mapping

| Tone | Visual Cue |
|---|---|
| tense | tight body language, narrowed eyes, clenched fists, sharp shadows |
| joyful | bright eyes, wide smiles, dynamic posing, warm lighting |
| sad | downcast eyes, slumped posture, muted colors, rain or tears |
| angry | furrowed brow, gritted teeth, clenched fists, harsh red lighting |
| fearful | wide eyes, trembling, recoiling posture, dark oppressive shadows |
| romantic | soft focus, warm golden light, gentle expressions, blush |
| mysterious | heavy shadows, fog, obscured faces, cool blue tones |
| epic | dramatic perspective, sweeping vista, intense lighting from above |
| comedic | exaggerated expressions, dynamic poses, bright colors, motion lines |
| melancholic | distant gaze, somber expression, fading light, autumn tones |
| hopeful | upward gaze, soft warm light breaking through, gentle smile |

### Aspect Ratio Calculation

```typescript
const PAGE_W = 800, PAGE_H = 1131;
const aspect = (panel.bbox.w * PAGE_W) / (panel.bbox.h * PAGE_H);
// > 1.3 → "wide horizontal panel, aspect ratio X:1"
// < 0.77 → "tall vertical panel, aspect ratio 1:X"
// else → "roughly square panel, aspect ratio 1:1"
```

---

## 5. Negative Prompt Composition

**File:** `packages/ai/src/prompt.ts` — `composeNegativePrompt()`

Combines:
- `worldBible.artStyleNegative[]`
- Each character's `negativeConstraints[]`
- Hard-coded: `"no comic page", "no page layout", "no multiple panels", "no panel grid", "no panel borders", "no divided layout", "no split frame", "no gibberish text", "no watermarks", "no extra borders"`
- If no human characters: `"no human characters"`

---

## 6. Reference Image Conditioning

**File:** `packages/actors/src/actors/pipeline/steps/generate_refs.ts` + `render_panels.ts`

### Face Reference Generation (`generate_refs` step)

For each character without `canonicalFaceRef` (and not user-locked):
- Generates a headshot portrait using the text-to-image renderer
- Prompt: `"Character reference sheet — single headshot portrait of {name}. {description}. Front-facing, neutral expression, plain background, consistent lighting, high detail face, no text, no watermark."`
- Persists storage key to `CharacterProfile.canonicalFaceRef`

### Reference Conditioning in Render (`render_panels` step)

When building `PanelRenderRequest`:
```typescript
referenceImageKeys: panel.characters
  .map(slot => charById.get(slot.characterId))
  .filter(c => c !== undefined)
  .flatMap(c => [c.canonicalFaceRef, c.canonicalBodyRef]
    .filter(k => typeof k === "string"))
```

The AISDK renderer (`packages/renderers/src/aisdk.ts`) uses the first reference image as input for OpenAI's `/v1/images/edits` endpoint (image-to-image conditioning).

---

## 7. Panel QA

**File:** `packages/actors/src/actors/pipeline/steps/panel_qa.ts`

Two-stage quality check per rendered panel:

### Stage 1: Deterministic Image Quality (`evaluateImageQuality`)
- Sharp-based statistical analysis: entropy, mean, stddev
- Detects blank images (low entropy) and blurry images (low stddev)
- Auto-passes on error (non-fatal)

### Stage 2: VLM Prompt Adherence (`judgePromptAdherence`)
- Uses `gpt-4o-mini` to judge if the rendered image matches the render prompt
- Requires `OPENAI_API_KEY` — skipped if absent
- Auto-passes on error (non-fatal)

### QA Status Values
- `pending` — not yet checked
- `passed` — both checks passed
- `failed` — either check failed
- `regenerate` — flagged for re-render

---

## 8. Page/Panel Planning

**File:** `packages/actors/src/actors/pipeline/steps/plan_chapters.ts`

- Every beat gets its own panel (fixed: was previously capped at 12 per chapter via `sampleEvenly`)
- `DEFAULT_BEATS_PER_PAGE = 3` — 3 panels per page
- Page count = `ceil(totalBeats / 3)`
- Panel bbox: full width (0.05–0.95), evenly split vertically
- Panel description = beat summary
- Panel cameraFraming = beat cameraHint
- Panel characters mapped from beat's `charactersPresent` IDs
- Render prompt composed via `composePanelPrompt()` and persisted to `panel.renderPrompt`

---

## 9. LLM Provider Configuration

**File:** `packages/ai/src/planner.ts` — `resolveLanguageModel()`

Supported providers (all via `@ai-sdk/openai` `createOpenAI`):
- `openai` — direct OpenAI API
- `anthropic` — via `@ai-sdk/anthropic`
- `google` — via `@ai-sdk/google`
- `groq` — OpenAI-compatible, base URL `https://api.groq.com/openai/v1`
- `pollinations` — OpenAI-compatible, base URL `https://gen.pollinations.ai/v1`
- `openrouter` — OpenAI-compatible, base URL `https://openrouter.ai/api/v1`

**Mastra agent model config** (`buildModelConfig` in `packages/actors/src/agents/index.ts`):
- `openrouter/{model}` for OpenRouter (model IDs are `org/model` paths)
- `pollinations/{model}` for Pollinations
- `openai/{model}` for OpenAI direct

---

## 10. Bible Builder Agent

**File:** `packages/actors/src/agents/index.ts` — `makeBibleBuilderAgent()`

**System prompt:**
```
You build and maintain the story bible from chapter transcriptions.

When processing a new chapter:
1. Extract characters, locations, objects, events from the text
2. Use character-lookup to check if characters already exist in the bible
3. Use character-timeline to track state changes (outfit, location, mood)
4. Use world-lookup to check existing world information
5. Use vector-query to find related context from other chapters
6. Use section-query to find structured story sections from previously planned chapters for continuity context
7. Flag contradictions with previous chapters

Output: structured JSON with knowledge updates.
```

**Schema (bibleBuildSchema):**
```typescript
{
  characters: [{ name, description, role, isNew }],
  characterStates: [{ characterName, outfit, location, mood, notes }],
  worldUpdates: { setting?, newRules: string[] },
  wikiPages: [{ type: enum, title, content }],
  contradictions: [{ description, existingInfo, newInfo }],
}
```
