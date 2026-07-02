# 06 — Lessons from v1 (AudioComic post-mortem)

Sources: AUDIT.md (2026-06-29 full audit), plan docs, ~125-commit history, DeepWiki.
Each lesson states the v1 evidence and the v2 decision it produced.

## Orchestration

1. **Rivet actors + Effect v4 beta was the #1 friction source.** Serial actor action
   queues made `GetStatus` block behind long LLM calls (hanging spinners); Effect v4 beta
   churned APIs mid-build (`catchAll` removed), forced `declaration: false` workarounds,
   and required vendoring the effect repo just to have docs. `orDie` overuse turned schema
   mismatches into silent process death.
   → **v2: no actor framework, no Effect.** Postgres job queue + chapter state machine +
   plain async/await. Control plane (API reads) and execution plane (worker) share only
   the DB, so status reads can never block on work.
2. **The general workflow engine was never needed.** v1 built pause/resume/retry/skip/
   cron/stale-detection per step; real usage collapsed 15 steps into a few mega-steps,
   leaving 8 orphaned dead files.
   → **v2: 7 real stages, one job shape, idempotency via output-existence checks,
   staleness via content hashes.**
3. **Idempotent skip was the one orchestration idea that worked** (`renderResultId`
   check made re-runs safe and cheap).
   → **v2: elevate it to a doctrine — every stage resumable at item granularity.**

## AI / generation

4. **Character consistency is the hardest problem and text-only prompting doesn't solve
   it.** v1's `referenceImageKeys` was hardcoded `[]`; canonical face refs existed in
   schema but were never populated; wiring image-edit conditioning came only in the final
   audit sprint. Meanwhile enormous effort went into text-side workarounds (3-layer char
   dedup, description cleanup passes, character-state timelines).
   → **v2: consistency is Stage 3 (Cast) — the product's centerpiece and a human gate.
   Multi-reference image models are a hard requirement for the render adapter.**
5. **Continuity context must stay out of image prompts.** Injecting section memory into
   panel prompts caused multi-panel collage outputs; v1 discovered this and stripped it.
   → **v2: retrieval/memory feeds *planning* stages only; image prompts come from a
   deterministic compiler designed fresh in 08-prompts.md (v1's prompt text itself is
   NOT ported — only this structural lesson).**
6. **Structured LLM output needs defense-in-depth, centralized.** v1 accumulated fixes
   scattered across call sites: JSON-fallback, pass-splitting after degenerate empty
   outputs, Zod `.default()` yielding `undefined`, 120s timeouts, dedup merges.
   → **v2: one LLM adapter wrapper owns validate → repair → degenerate-check → escalate,
   with fixture tests.**
7. **Two parallel planner implementations (AI SDK class + Mastra agents) coexisted with
   no test parity**, and Mastra added streaming/structured-output bugs of its own.
   → **v2: one SDK (Vercel AI), no agent framework; "tools" become explicit context
   assembly.**
8. **Free-form layout generation needs repair loops; templates don't.** v1 let the LLM
   emit raw bboxes, then validated 5 properties and repaired.
   → **v2: curated layout template library; LLM assigns beats to slots; invalid layouts
   unrepresentable. Keep v1's 5 validation checks as a safety net.**
9. **Lettering: baked-in text was a dead end walked into.** v1 started with SVG overlay,
   pivoted to in-image bubbles to skip placement UX; result: unfixable typos, no edit/
   localization path, model text artifacts.
   → **v2: 100% typeset overlay, settled permanently; smart placement via cheap VLM
   face-locate; bonus — screen-reader accessible and translation-ready.**
10. **Panel QA must warn, not gate.** v1 shipped a placeholder QA (all pass), then a
    strict one; both wrong.
    → **v2: pixel-stats + VLM identity/adherence checks → badges + one auto-retry;
    humans decide the rest in the pages editor.**
11. **Segment-level timestamps are sufficient for sync** (user explicitly dismissed
    word-level in v1).
    → **v2: segment-level by default; word-level is an isolated adapter upgrade if ever
    needed.**

## Data

12. **Schema/migration drift silently ate data** (`speaker` column dropped by repo
    mapping; `render_model` had no migration).
    → **v2: migrations are source of truth; CI diff-check against Drizzle schema.**
13. **Ordering must be a DB constraint from day 1** — v1 retrofitted position columns
    after the canvas showed panels in random order.
    → **v2: `position` + unique constraint on every ordered entity.**
14. **Schema-first scaffolding creates zombie features.** Issue entity, panel_edits,
    TTS fields, `ipAdapterRefs`, `bleed` — all defined, none consumed, all confusing.
    → **v2: no column without a consumer in the same milestone.**
15. **7 embedded tables, 2 useful.** Embedding sprawl added cost/complexity.
    → **v2: bible entries + scene summaries only.**

## Product / UX

16. **The pipeline dashboard leaked implementation into UX.** Users saw DAGs and step
    buttons; the per-chapter redesign doc itself concluded the pipeline tab should die.
    → **v2: chapter rail with status lines; machinery invisible.**
17. **Review gates were bolted on; money burned before eyes on output.** Auto-pause
    after prompt composition and the storyboard tab arrived last, not first.
    → **v2: two gates are the product's spine; zero image spend before approval.**
18. **The canvas editor was v1's best asset** — production-quality panel/bubble editing
    (drag, resize, inline edit, optimistic saves).
    → **v2: keep the shape, rebuild on typeset bubbles + render version strips.**
19. **No cost visibility anywhere.**
    → **v2: usage_events metering, wizard-time estimates, per-project budget caps.**
20. **v1 had no consumption story** — it produced files, not an experience.
    → **v2: the synced read-along reader is the flagship output and the demo.**

## Process

21. **Docs drifted into contradiction** (5 overlapping plan files; audit had to correct
    its own dead-code claims).
    → **v2: this revamp/ plan is the founding contract; after build starts, code +
    typecheck are truth and plans get deleted when executed.**
22. **Zero tests + broken typecheck for weeks** made every refactor a gamble; eval
    functions existed but were never wired.
    → **v2: CI gates from M0; evals run against a fixture book as scripted checks
    (consistency/layout/timing) starting M2.**
23. **dev.sh (port-kills, 3 terminals, env foot-guns) burned real time repeatedly.**
    → **v2: `bun dev` + compose; two required secrets; no restart-to-change-env traps.**
