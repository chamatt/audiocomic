# 08 — Prompt Design

Designed from first principles for this system. v1's prompt engineering is deliberately
NOT ported — treat everything here as a starting spec to be iterated against the eval
harness (09 §evals), not as received wisdom.

## Principles

1. **Prompts are compiled, not written.** Every prompt is produced by a pure function in
   `core/prompt/` from structured data. LLMs never author image prompts free-form; they
   author *structured fields* (description, camera, mood) that the compiler assembles.
   This keeps prompts consistent, testable, and editable at the field level.
2. **One claim per sentence, ordered by importance.** Both LLM and image models degrade
   on buried instructions. Front-load what matters.
3. **Separate WHAT from HOW.** Planning prompts describe story content; the compiler owns
   rendering vocabulary (style, camera language, quality terms). Planners never emit
   style words — style lives solely in the style pack.
4. **Schema is the instruction.** For structured calls, the zod schema (with
   `.describe()` on every field) carries most of the guidance; the prompt supplies
   context and judgment criteria, not format rules.
5. **Iterate against evals, not vibes.** Every prompt template has a fixture test: given
   canned input, assert structural properties of output (counts, lengths, no style
   words in planner output, etc.). Image prompt changes get A/B'd on the fixture book.

## System prompt: Script stage (scenes/beats/dialogue)

Role framing + judgment criteria; format comes from the schema.

```
You are a comic book adaptation editor. You convert prose narration into a
comic script: scenes, beats, and dialogue.

A SCENE is a continuous span with one location and cast. Cut a new scene when
location, time, or point-of-view changes.

A BEAT is one drawable moment: a single action or exchange a reader should see
as an image. A beat is NOT a summary of events — "they argue about the map" is
two or three beats (accusation, rebuttal, the map slammed on the table), not one.
Good beats name concrete, visible things: who is present, what they physically
do, what the viewer sees.

DIALOGUE rules:
- Extract spoken lines and inner thoughts from the prose. Attribute the speaker;
  if attribution is uncertain, set speakerConfidence to "low" rather than guessing
  confidently.
- Compress lines to bubble length (max ~20 words) while keeping voice. Long
  speeches become multiple dialogue entries across consecutive beats.
- Narration entries carry essential prose the images cannot show (time skips,
  interiority). Prefer showing over narrating: if a beat's action already
  conveys it, do not add a narration box.
- Never invent lines that change story content. Compression yes, invention no.

Pacing: aim for 1 beat per 2-4 transcript segments in dialogue-heavy passages,
1 beat per 4-8 segments in descriptive passages. Big reveals and turning points
deserve their own beat even if brief.

Each beat and scene must carry segmentStart/segmentEnd covering every segment
exactly once, in order, with no gaps or overlaps.
```

User message per chunk: `STORY SO FAR:\n{rollingSummary}\n\nKNOWN ENTITIES:\n{bibleTopK}\n\nTRANSCRIPT SEGMENTS {n}-{m}:\n{numbered segments}` — numbered so the model returns positions, not text spans.

## System prompt: Bible extraction (runs with script stage)

```
You maintain a story bible. From this passage, extract entities worth tracking:
characters (named or recurring), locations that scenes happen in, and objects
with narrative weight.

For each entity return:
- name: canonical name; aliases: other names/epithets used in the text
- summary: narrative role in one or two sentences
- visualSpec: ONLY what the text states or strongly implies about appearance,
  as short declarative fragments ("mid-40s", "grey-streaked beard", "naval
  officer's coat, brass buttons"). Where the text is silent, write nothing —
  do NOT invent appearance details here. Invention happens later, at casting,
  where a human reviews it.
- evidence: 1-3 short verbatim quotes supporting the visual claims.

Do not extract: one-off background figures, generic locations ("a corridor"),
mundane objects. When unsure whether an entity was seen before, extract it
anyway with its aliases — deduplication happens downstream.
```

Dedup after extraction is code, not prompt: normalized-name match, then alias
intersection, then embedding cosine > 0.86 → same entity; merge summaries with a fast
LLM call only when a merge actually happens.

## System prompt: Casting (visual spec completion)

At cast stage, specs are *completed* — the one place invention is allowed, because a
human gate follows immediately.

```
You are a character designer. Complete this character's visual specification
for a model sheet. The text-derived facts below are canon and must be kept
verbatim. Fill the gaps (face shape, hair, build, wardrobe, palette, one
distinguishing feature) with choices that fit the story's period, setting,
and the character's role and personality. Output the spec as 6-10 short
fragments, most identifying features first. No style or art terms — those
are added elsewhere. No names of real people.
```

## Image prompt compiler (`core/prompt/panel.ts`)

The compiler emits a fixed-shape prompt. Rationale for the shape:
- **A framing envelope** states the task once, plainly. Modern multi-ref image models
  follow instructions; we prefer one clear sentence over keyword soup, but keep the
  body fragment-based so field edits map 1:1 to prompt lines.
- **Reference binding by name**: refs are attached as images; the prompt binds each
  name to a reference ("Kestrel — as shown in reference image 1") so the model links
  identity to image, not to a re-described face. The compiler never restates a
  character's face when a ref is attached (double-description causes drift: the model
  averages the text and the image).

Template (line order fixed):

```
Single comic book panel, one moment in time, one scene.
{shot phrase}: {description}.
{For each character, ref-attached}:  {Name} — exactly as in reference image {i}{, stateDelta if any}.
{For each character, no ref}:        {Name}: {visualSpec fragments}.
Setting: {location fragment or ref binding}. {timeOfDay}, {mood} atmosphere.
{style pack fragment}
No text, no words, no letters, no speech bubbles, no captions anywhere in the image.
```

- `stateDelta` is per-chapter appearance change ("now wounded, torn sleeve") — the only
  continuity data allowed into image prompts, one fragment max.
- The anti-text line is ALWAYS last and always present (typeset lettering is a hard
  invariant; last position because trailing instructions are what image models most
  recently attended).
- `shot phrase` map lives in code: `close_up → "Close-up"`, `establishing → "Wide
  establishing shot"`, etc. Small, boring, exhaustive.
- Negative prompt (providers that support it): `text, watermark, signature, speech
  bubble, caption, panel borders, comic page, multiple panels, collage, grid`.
- Length budget enforced by `ImageGen.capabilities().maxPromptChars`; the compiler
  truncates lowest-priority lines first (mood → setting detail → secondary characters),
  never the envelope or anti-text lines.

## Cast sheet prompt

```
Character model sheet, front-facing portrait, neutral expression, plain light
grey background. {Name}: {completed visualSpec}. {style pack fragment}.
No text or labels.
```

Full-body variant swaps the first clause. Location refs: `Establishing wide shot of
{name}: {visualSpec}. Unpopulated. {style}. No text.`

## VLM QA prompts

Panel QA (one call, one JSON verdict):

```
Judge this comic panel. Reference images: {character sheets used}.
Answer in JSON:
- singlePanel: is this ONE scene (not a collage/grid/multi-panel page)?
- textFree: is the image free of rendered text, letters, or bubble shapes?
- matchesDescription: does it depict: "{description}"?
- identity: for each named character, does the figure match its reference
  sheet (face, hair, wardrobe)? List mismatches concretely.
- verdict: pass | warn | fail   (fail only for: not single panel, contains
  text, wrong character count, or flagrant identity mismatch)
```

Face-locate for bubble placement: `Return normalized bounding boxes for every visible
face/head in this image as JSON [{x,y,w,h}]. Empty array if none.`

## Storyboard prompt (beats → pages/panels)

```
You are a comic layout artist. Assign the given beats to pages using the
provided layout templates. Rules:
- Preserve beat order. Reading order within a page follows slot order.
- Choose density by content: conversation → 4-6 slot templates; action →
  2-3 slots; a reveal or climax → splash. Never exceed 20 dialogue words
  per panel; split the beat across panels instead.
- End pages on mini-cliffhangers when the material allows (page turns are
  a storytelling device).
- For each panel: write `description` as one sentence of what is VISIBLE
  (subjects, action, spatial arrangement). No camera words in description —
  set the `camera` field instead. No style words ever.
Available templates: {id, slots, tags} list.
```

## Prompt iteration protocol

- Templates live in `core/prompt/` as code with a `PROMPT_VERSION` constant; the version
  is stamped onto every render/scene row so output quality can be correlated to prompt
  changes.
- The fixture book (public-domain novella, checked into the repo as test data) is the
  benchmark: script quality (beat granularity, dialogue attribution), render quality
  (single-panel rate, text-free rate, identity pass rate) measured per prompt version.
- Rule: no prompt change merges without a fixture run showing the affected metric
  didn't regress.
