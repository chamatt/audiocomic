# 05 — Roadmap

Build order optimizes for **walking skeleton first**: the thinnest end-to-end path
(upload → read a synced comic) ships in M1, then every milestone deepens quality.
v1's failure mode was breadth-first scaffolding (15 steps, 12 packages, 6 actors, many
stubs); v2 is depth-first: nothing is stubbed, some things are absent.

## M0 — Foundations (week 1)

- Repo scaffold: app + core/engine/db + worker, one tsconfig, CI (typecheck + unit tests
  gate merges from day 1).
- `compose.yaml`: postgres(+pgvector), minio, app, worker. `bun dev` runs app+worker
  with hot reload — one command, no dev.sh.
- Job queue (claim/heartbeat/reap/retry) with tests. Adapters: LLM wrapper
  (generateObject + repair + degenerate-check), BlobStore, FakeAdapters for tests.
- Drizzle schema for project/chapter/segment/job planes + migration CI check.

Exit: `bun test` green; a demo job round-trips through the queue with crash recovery.

## M1 — Walking skeleton (weeks 2–3) 🎯 *the make-or-break milestone*

Thinnest full path, one chapter, defaults everywhere, no gates yet:

- Ingest: mp3/m4b upload → chapter split → Groq whisper → segments.
- Script: scenes/beats/dialogue via chunked LLM calls (no bible retrieval yet).
- Storyboard: template-based pages/panels + deterministic prompt compiler + validator.
- Render: text+style-ref rendering (single style pack, no cast refs yet), progress SSE.
- Letter+compose: naive bubble placement (top of panel, reading order), sharp compose.
- Publish: manifest + minimal reader (panel mode, audio sync, tap-to-seek).
- Chapter rail UI with live status.

Exit criterion: **a real audiobook chapter becomes a readable synced comic, unattended,
in <15 min, for <$3.** Everything after this is quality, not plumbing.

## M2 — Consistency engine (weeks 4–5)

- Bible extraction during script stage; dedup merge; pgvector retrieval into script/
  storyboard context.
- Cast stage: visual specs → model sheet candidates → **cast gallery gate UI**.
- Render switches to multi-reference conditioning (gemini-flash-image primary; fal
  FLUX-kontext fallback adapter).
- VLM panel QA (identity vs ref sheet + prompt adherence) with warn badges + auto-retry.
- Benchmark: consistency eval (same-character similarity across panels) wired as a
  scripted check against a fixture book; target ≥90% pass.

## M3 — Review gates & editing (weeks 6–7)

- Storyboard review UI (wireframes, inline edits, template picker, density warnings,
  approve-to-render).
- Pages tab: render version strip, per-panel regenerate with notes, batch re-render,
  bubble drag/edit with instant recompose.
- Staleness badges (prompt/cast edits → affected panels flagged; hash-based recompute
  for pages/exports).
- Mini cast-gate for new characters in later chapters.

## M4 — Reader polish + exports (week 8)

- Reader: page mode w/ spotlight, transport polish, speed control, share links,
  silent-mode fallback.
- Exports: CBZ, PDF (pdf-lib), MP4 motion comic (Ken Burns table, bubble burn-in,
  audio mux), captions track.
- VLM face-locate for smart bubble placement.
- Cost meter surfaces + per-project budget cap (hard stop on render stage).

## M5 — Robustness & launch (weeks 9–10)

- Full-book scale test (10+ hr audiobook): parallel chapters, rate-limit tuning,
  resume-from-anywhere chaos test (kill worker mid-render).
- epub/txt ingest path (silent projects).
- Hosted deploy recipe (Vercel + Neon + R2 + Fly worker) alongside compose.
- Onboarding demo project (pre-baked public-domain book so first-run shows a finished
  result instantly).

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Multi-ref image models still drift on identity | Med | Layered strategy (spec text + refs + QA retry + human regen); benchmark in M2 before building further on it; style packs that tolerate drift (stylized > photoreal) |
| Script stage misattributes dialogue speakers | Med | Bible-aware prompting + speaker confidence field + one-click speaker fix in storyboard review |
| Long-book LLM drift ("story so far" degrades) | Med | Rolling summaries + scene-embedding retrieval; evaluate on a full novel in M5 |
| Image provider API churn/pricing | High | Adapter layer + 2 providers wired from M2; provider policy per project |
| Timing feels off in reader (segment-level granularity) | Low-Med | v1 evidence says segment-level is fine; word-level timestamps are an isolated upgrade inside the transcription adapter if needed |
| Scope creep back toward v1 (workflow engine, wiki, TTS) | High | 00-vision "NOT building" list is a contract; any new subsystem needs a user-visible feature justifying it |

## Deliberate deferrals (post-launch)

- Local rendering adapter (ComfyUI/SDXL) for zero-marginal-cost power users.
- Multi-user / sharing beyond read-only links.
- Localization: bubble text is already typeset+stored, so translation is a data pass —
  design allows it, launch doesn't include it.
- Voice-per-character TTS for text-ingested projects.
- Style transfer of user-uploaded art as custom style packs (beyond a single style ref).
