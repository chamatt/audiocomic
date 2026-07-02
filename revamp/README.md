# Storyweave — Revamp Plan

A from-scratch rebuild of the audiobook→narrated-comic idea. New repo, new name, no code reuse.
This directory is the complete plan. Read in order:

| Doc | Contents |
|---|---|
| [00-vision.md](00-vision.md) | Problem, thesis, target users, product principles, what we're NOT building |
| [01-architecture.md](01-architecture.md) | Stack, system design, why each choice — grounded in v1 lessons |
| [02-pipeline.md](02-pipeline.md) | The 7-stage production pipeline: contracts, models, consistency strategy, QA |
| [03-data-model.md](03-data-model.md) | Entities, storage layout, versioning of AI artifacts |
| [04-ux.md](04-ux.md) | Screens, flows, review gates, the synced web reader |
| [05-roadmap.md](05-roadmap.md) | Milestones M0–M5, build order, risk register |
| [06-lessons-from-v1.md](06-lessons-from-v1.md) | Post-mortem of AudioComic v1 — every decision here traces to one of these |
| [07-contracts.md](07-contracts.md) | Concrete zod schemas, stage contract, state machine, API routes, SSE events, reader manifest, adapter interfaces |
| [08-prompts.md](08-prompts.md) | Prompt design from first principles: all system prompts, the image prompt compiler, QA prompts, iteration protocol |
| [09-implementation-notes.md](09-implementation-notes.md) | Dev env, job queue SQL, timing math, bubble placement, ffmpeg recipes, layout template library, evals |

## One-paragraph summary

Storyweave turns an audiobook (or ebook) into a **narrated comic**: a comic book whose
panels are synchronized to the original narration audio. The v1 prototype (AudioComic)
proved the staged-generation thesis (MangaFlow-style explicit intermediates) but drowned
in orchestration machinery (Rivet actors + Effect v4 beta), shipped consistency as an
afterthought, and exposed a debug pipeline as its UX. The rebuild inverts priorities:
**character consistency and human review gates are the product**; orchestration is a
boring Postgres job queue; the pipeline is invisible; and the flagship output is a
web-based read-along reader, with CBZ/PDF/MP4 as exports.

## The three bets

1. **Casting before rendering.** Users approve a visual "cast" (reference sheets per
   character/location) before a single panel is generated. Every panel render is
   multi-reference-conditioned. This attacks the hardest problem (consistency) at the
   root instead of patching it downstream.
2. **Two review gates, zero pipeline UI.** Users review (a) the cast and (b) the
   storyboard/script. Everything else is automatic with visible progress. No DAG
   graphs, no step buttons.
3. **Read-along reader as the flagship output.** Audio plays; panels light up in sync;
   bubbles are crisp typeset text. Exports (CBZ/PDF/MP4) are projections of the same
   timeline data.
