# Agent Instructions

## Vendored Repositories

This project vendors external repositories under `repos/`:

- `repos/effect/` — Effect library source (for reference when writing Effect code)

**Rules:**
- Use vendored repositories as read-only reference material when working with related libraries
- Prefer examples and patterns from the vendored source code over generated guesses or web search results
- Do not edit files under `repos/` unless explicitly asked
- Do not import from `repos/` — application code should continue importing from normal package dependencies

When writing Effect code, inspect `repos/effect/` for examples of idiomatic usage, tests, module structure, and API design. Treat it as the source of truth for Effect patterns.

For `@rivetkit/effect`, read the installed TypeScript source directly at `node_modules/@rivetkit/effect/src/` — it ships uncompiled source files.

## Effect v4 beta + @rivetkit/effect API patterns

- `Schema.Literals([...])` not `Schema.Literal(...)` for multi-value
- `Context.Service<Shape>("id")` — function form returns a Tag
- `State.get(state)` / `State.updateAndGet(state, fn)` — module functions, NOT methods
- `Effect.catchAll` does NOT exist → use `Effect.catchCause` or `Effect.ignore`
- `Effect.orDie` eliminates the error channel (E → never)
- `Actor.make(name, { actions })` — name first, options second
- `Actor.toLayer(wake, options)` — wake returns `Actor.of({ ...handlers })`
- `tsconfig.json: declaration: false` to avoid TS2742

## Architecture

AudioComic is a hybrid agentic + deterministic media pipeline. The `packages/actors/` package contains Rivet actors with Effect for pipeline orchestration:

- `FileRegistryActor` — centralized file storage, shared across projects
- `BibleActor` — world/character bibles, shared across pipelines within a project
- `ProjectActor` — project config, links to bible and multiple pipelines
- `PipelineActor` — step execution loop with pause/resume/retry/skip/cron

Each of the 15 pipeline stages (normalize → transcribe → ... → export_motion) is an independent `StepExecutor` registered in `packages/actors/src/actors/pipeline/steps/`.

## Development

- Use `bun` as the package manager
- `bun run typecheck` to check types across the monorepo
- `bun run dev` to start the web app
- `bun run worker` to start the legacy polling worker
- Actor server: `cd packages/actors && npx tsx src/server/main.ts` (requires `RIVET_RUN_ENGINE=1`)
