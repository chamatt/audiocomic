# 00 — Vision & Product Definition

## The problem

Audiobooks and novels are linear, imageless media. Comics are dense visual storytelling
but expensive to produce (~$100–400/page for human production). Generative image models
can now draw individual panels well — but naive "book in, comic out" generation fails on
the four things that make a comic a comic:

1. **Character consistency** — the same person must look the same across hundreds of panels.
2. **Narrative pacing** — deciding what deserves a splash page vs. a 6-panel grid is
   editorial judgment, not generation.
3. **Legible lettering** — image models still produce garbled or misspelled text; bubbles
   must be typeset, not hallucinated.
4. **Long-form memory** — chapter 12 must remember what the castle looked like in chapter 2.

## The thesis (validated by v1)

**Decompose, don't generate end-to-end.** Every intermediate artifact — the script, the
cast, the page layouts, the panel prompts — is an explicit, inspectable, *editable*
variable. LLM agents propose; deterministic code validates and composes; humans approve
at exactly two gates. This is the MangaFlow insight, and v1 proved it works. What v1 got
wrong was everything *around* it (see 06-lessons-from-v1.md).

## What Storyweave is

> **Upload an audiobook. Approve the cast. Approve the storyboard. Read your comic —
> with the original narration playing along.**

A web app that converts long-form narrated audio (audiobooks, podcasts fiction, m4b
files with chapters) or text (epub, txt) into:

- **A synced web reader** (flagship): panels highlight as narration plays; tap any
  panel to jump the audio; works on phone/tablet.
- **Static exports**: CBZ and PDF per chapter or whole book.
- **Motion comic video**: MP4 with Ken Burns panel motion, burned-in bubbles, muxed audio.

## Target users, in priority order

1. **Self-consumers** — people who own audiobooks and want a richer way to experience
   them (the "graphic-novelize my library" crowd). Tolerant of AI art style; care about
   consistency and sync quality.
2. **Indie authors** — want a comic adaptation of their book as a marketing asset or
   product. Care about style control and editability.
3. **Accessibility / education** — visual companion for language learners, readers with
   auditory processing needs. Care about the read-along mode specifically.

Not targeting professional comic studios. Not targeting real-time generation.

## Product principles

1. **The pipeline is invisible.** Users see a chapter's *status* ("Casting… Storyboarding…
   Drawing page 4/12…"), never a DAG. Progress, not plumbing.
2. **Two gates only.** (a) Cast approval — "do these characters look right?" (b) Storyboard
   approval — "is this the right story breakdown?" Everything after a gate is automatic.
   Everything before a gate is cheap (text/refs only, no mass rendering).
3. **Money is spent only after approval.** Cast + storyboard cost cents (LLM text + a
   handful of reference images). Mass panel rendering — the expensive part — happens only
   after both gates pass.
4. **Every AI artifact is editable and versioned.** Regenerate any panel, edit any bubble,
   reword any prompt, swap a character's look — without invalidating unrelated work.
5. **Chapters are independent production units.** Chapter 3 renders while chapter 7
   transcribes. A shared, append-only "story bible" is the only cross-chapter coupling.
6. **Deterministic where possible.** Layout validation, page composition, lettering,
   timing math, exports — all pure functions of stored data. AI is confined to: transcribe,
   plan, draw, judge.
7. **Provider-agnostic from day one.** Every model call (LLM, image, TTS-optional,
   transcription, embeddings) goes through an adapter with a config-selected provider.
   v1 proved this pays for itself immediately (OpenAI → Pollinations → OpenRouter swaps).

## What we are explicitly NOT building (v1 scope traps)

- **No diarization / voice cloning / TTS.** Source audio IS the narration. Text-only
  ingest gets silent reading mode (v1 wasted schema on TTS it barely used).
- **No general workflow engine.** v1 built an n8n-style DAG runner with stale detection,
  cron, pause/resume/skip per step. Nobody needed it. We need exactly one shape of job:
  "run stage N for chapter C, idempotently, with retry."
- **No wiki governance system.** v1's LLM-wiki with naming conventions, lint rules, and
  conflict resolution was scope creep. The bible is structured rows + embeddings, period.
- **No ComfyUI self-hosting path at launch.** API-based image providers only. Local SD
  is a later adapter, not an architectural driver.
- **No real-time collaboration.** Single-user projects at launch.

## Success criteria (v2 must beat v1 on these)

| Metric | v1 reality | v2 target |
|---|---|---|
| Character identity across a chapter | Fragile, text-prompt-only | ≥90% panels pass automated identity check vs cast ref |
| Time from upload → reviewable storyboard (1 chapter) | ~10+ min, opaque | <5 min with live progress |
| Cost surprise | Renders before review | $0 image spend before both gates |
| Setup | Docker + dev.sh + 3 processes + 7 env vars | `docker compose up` or hosted; 2 required keys |
| Lettering legibility | Baked into image (garbled risk) | 100% typeset (SVG/canvas), zero in-image text |
| Reader experience | None (exports only) | Synced read-along on mobile web |
