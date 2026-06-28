#!/usr/bin/env bun
/**
 * AudioComic Pipeline CLI — control individual pipeline steps.
 *
 * Usage:
 *   bun packages/actors/cli.ts <command> [options]
 *
 * Commands:
 *   status <key>                          Show pipeline status + all steps
 *   run <key> --from <step> [--to <step>] Run pipeline (or a slice of steps)
 *   add <key> <type> [--id <id>] [--config <json>]  Add a single step
 *   add-all <key> [--input <path>]        Add all 15 steps with defaults
 *   pause <key>                           Pause running pipeline
 *   resume <key>                          Resume paused pipeline
 *   retry <key> <stepId>                  Retry a failed step
 *   skip <key> <stepId>                   Skip a failed step
 *   result <key> <stepId>                 Show a step's result (JSON)
 *   watch <key>                           Poll status until terminal
 *   list                                   List all pipeline keys (best-effort)
 *
 * Examples:
 *   # Add just the normalize step and run it
 *   bun cli.ts add myproj normalize --config '{"inputPath":"/path/to/audio.m4b"}'
 *   bun cli.ts run myproj
 *   bun cli.ts result myproj normalize
 *
 *   # Run only transcription (needs normalize already completed)
 *   bun cli.ts add myproj transcribe
 *   bun cli.ts run myproj
 *
 *   # Run from plan_story through render_panels
 *   bun cli.ts add-all myproj --input /path/to/audio.m4b
 *   bun cli.ts run myproj --from plan_story --to render_panels
 */

import { Client } from "@rivetkit/effect";
import { Effect } from "effect";
import { Pipeline } from "./src/actors/pipeline/api.ts";
import type { PipelineState } from "./src/actors/pipeline/api.ts";
import type { StepState, StepDefinition } from "./src/lib/schemas.ts";

const endpoint = process.env.RIVET_ENDPOINT ?? "http://127.0.0.1:6420";
const ClientLayer = Client.layer({ endpoint });

// ─── Step catalog ───────────────────────────────────────────────────────────

const STEP_CATALOG: ReadonlyArray<{ id: string; name: string; type: string; dependsOn: string[] }> = [
  { id: "normalize",     name: "Normalize Audio",    type: "normalize",       dependsOn: [] },
  { id: "transcribe",    name: "Transcribe",         type: "transcribe",      dependsOn: ["normalize"] },
  { id: "segment",       name: "Segment",            type: "segment",         dependsOn: ["transcribe"] },
  { id: "plan_story",    name: "Plan Story",         type: "plan_story",      dependsOn: ["segment"] },
  { id: "build_bibles",  name: "Build Bibles",       type: "build_bibles",    dependsOn: ["plan_story"] },
  { id: "section_mem",   name: "Section Memory",     type: "section_memory",  dependsOn: ["build_bibles"] },
  { id: "plan_pages",    name: "Plan Pages",         type: "plan_pages",      dependsOn: ["section_mem"] },
  { id: "validate",      name: "Validate Layout",    type: "validate_layout", dependsOn: ["plan_pages"] },
  { id: "compose_pr",    name: "Compose Prompts",    type: "compose_prompts", dependsOn: ["validate"] },
  { id: "render_panels", name: "Render Panels",      type: "render_panels",   dependsOn: ["compose_pr"] },
  { id: "panel_qa",      name: "Panel QA",           type: "panel_qa",        dependsOn: ["render_panels"] },
  { id: "compose_pages", name: "Compose Pages",      type: "compose_pages",   dependsOn: ["panel_qa"] },
  { id: "lettering",     name: "Lettering",          type: "lettering",       dependsOn: ["compose_pages"] },
  { id: "export_static", name: "Export Static",      type: "export_static",   dependsOn: ["lettering"] },
  { id: "export_motion", name: "Export Motion",      type: "export_motion",   dependsOn: ["export_static"] },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { cmd: string; positional: string[]; flags: Record<string, string> } {
  const args = argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }
  const cmd = args[0] ?? "";
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

function printUsage(): void {
  console.log(`
AudioComic Pipeline CLI — control individual pipeline steps.

Usage: bun packages/actors/cli.ts <command> [options]

Commands:
  status <key>                          Show pipeline status + all steps
  run <key> [--from <step>] [--to <step>]  Run pipeline (or a slice)
  run-step <key> <stepId>               Run a single step in isolation
  add <key> <type> [--id <id>] [--config <json>]  Add a single step
  add-all <key> [--input <path>]        Add all 15 steps with defaults
  add-range <key> --from <step> [--to <step>] [--input <path>]  Add a range
  pause <key>                           Pause running pipeline
  resume <key>                          Resume paused pipeline
  retry <key> <stepId>                  Retry a failed step
  skip <key> <stepId>                   Skip a failed step
  result <key> <stepId>                 Show a step's result (JSON)
  logs <key> <stepId>                   Show a step's progress events
  invalidate <key> <stepId>             Mark step + downstream as stale
  watch <key> [--timeout <ms>]          Poll status until terminal

Examples:
  # Add just normalize + transcribe and run
  cli.ts add myproj normalize --config '{"inputPath":"/path/to/audio.m4b"}'
  cli.ts add myproj transcribe
  cli.ts run myproj
  cli.ts result myproj transcribe

  # Run a single step in isolation (uses cached upstream outputs)
  cli.ts add-all myproj --input /path/to/audio.m4b
  cli.ts run myproj  # run full pipeline first
  cli.ts run-step myproj plan_story  # re-run just plan_story

  # Invalidate a step and its downstream dependents
  cli.ts invalidate myproj plan_story
  cli.ts logs myproj plan_story  # see progress events
`);
}

async function run<A, E, R>(program: Effect.Effect<A, E, R>): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.provide(ClientLayer)) as Effect.Effect<A, E, never>);
}

async function getState(key: string): Promise<PipelineState> {
  return run(Effect.gen(function* () {
    const accessor = yield* Pipeline.client;
    const handle = accessor.getOrCreate(key);
    return yield* handle.GetStatus(undefined);
  }));
}

async function addStep(key: string, step: StepDefinition): Promise<void> {
  await run(Effect.gen(function* () {
    const accessor = yield* Pipeline.client;
    const handle = accessor.getOrCreate(key);
    yield* handle.AddStep({ step });
  }));
}

async function startPipeline(key: string): Promise<void> {
  await run(Effect.gen(function* () {
    const accessor = yield* Pipeline.client;
    const handle = accessor.getOrCreate(key);
    yield* handle.Start(undefined);
  }));
}

async function pausePipeline(key: string): Promise<void> {
  await run(Effect.gen(function* () {
    const accessor = yield* Pipeline.client;
    const handle = accessor.getOrCreate(key);
    yield* handle.Pause(undefined);
  }));
}

async function resumePipeline(key: string): Promise<void> {
  await run(Effect.gen(function* () {
    const accessor = yield* Pipeline.client;
    const handle = accessor.getOrCreate(key);
    yield* handle.Resume(undefined);
  }));
}

async function retryStep(key: string, stepId: string): Promise<StepState> {
  return run(Effect.gen(function* () {
    const accessor = yield* Pipeline.client;
    const handle = accessor.getOrCreate(key);
    return yield* handle.RetryStep({ stepId });
  }));
}

async function skipStep(key: string, stepId: string): Promise<StepState> {
  return run(Effect.gen(function* () {
    const accessor = yield* Pipeline.client;
    const handle = accessor.getOrCreate(key);
    return yield* handle.SkipStep({ stepId });
  }));
}

async function runStep(key: string, stepId: string): Promise<StepState> {
  return run(Effect.gen(function* () {
    const accessor = yield* Pipeline.client;
    const handle = accessor.getOrCreate(key);
    return yield* handle.RunStep({ stepId });
  }));
}

async function getStepResult(key: string, stepId: string): Promise<unknown> {
  return run(Effect.gen(function* () {
    const accessor = yield* Pipeline.client;
    const handle = accessor.getOrCreate(key);
    return yield* handle.GetStepResult({ stepId });
  }));
}

async function getStepLogs(key: string, stepId: string): Promise<readonly unknown[]> {
  return run(Effect.gen(function* () {
    const accessor = yield* Pipeline.client;
    const handle = accessor.getOrCreate(key);
    return yield* handle.GetStepLogs({ stepId });
  }));
}

async function invalidateStep(key: string, stepId: string): Promise<readonly StepState[]> {
  return run(Effect.gen(function* () {
    const accessor = yield* Pipeline.client;
    const handle = accessor.getOrCreate(key);
    return yield* handle.InvalidateStep({ stepId });
  }));
}

// ─── Display ────────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  running: "◐",
  paused: "⏸",
  completed: "✓",
  failed: "✗",
  skipped: "→",
  stale: "⚠",
};

function printStatus(state: PipelineState): void {
  console.log(`\n  Pipeline: ${state.status}`);
  console.log(`  Steps:    ${state.steps.length}`);
  const completed = state.steps.filter((s) => s.status === "completed").length;
  const failed = state.steps.filter((s) => s.status === "failed").length;
  const stale = state.steps.filter((s) => s.status === "stale").length;
  const staleStr = stale > 0 ? `, ${stale} stale` : "";
  console.log(`  Progress: ${completed}/${state.steps.length} completed, ${failed} failed${staleStr}\n`);
  for (const step of state.steps) {
    const icon = STATUS_ICONS[step.status] ?? "?";
    const time = step.completedAt !== undefined
      ? `${((step.completedAt - (step.startedAt ?? step.completedAt)) / 1000).toFixed(1)}s`
      : step.startedAt !== undefined
        ? "running..."
        : "";
    const summary = step.summary !== undefined ? `  ${step.summary}` : "";
    const err = step.error !== undefined ? `  ⚠ ${step.error}` : "";
    console.log(`  ${icon} ${step.definition.id.padEnd(16)} ${step.status.padEnd(10)} ${time.padEnd(12)}${summary}${err}`);
  }
  console.log();
}

function printResult(step: StepState): void {
  console.log(`\n  Step: ${step.definition.id} (${step.status})`);
  if (step.error !== undefined) {
    console.log(`  Error: ${step.error}\n`);
    return;
  }
  if (step.result === undefined) {
    console.log("  No result.\n");
    return;
  }
  // Unwrap StepOutput if present
  const result = step.result as { data?: unknown; summary?: string; inputHash?: string } | unknown;
  if (typeof result === "object" && result !== null && "data" in result && "inputHash" in result) {
    const output = result as { data: unknown; summary: string; inputHash: string };
    console.log(`  Summary: ${output.summary}`);
    console.log(`  InputHash: ${output.inputHash}`);
    console.log("  Data:");
    console.log(JSON.stringify(output.data, null, 2));
  } else {
    console.log("  Result:");
    console.log(JSON.stringify(result, null, 2));
  }
  console.log();
}

// ─── Step building ──────────────────────────────────────────────────────────

function makeStepDef(
  step: { id: string; name: string; type: string; dependsOn: string[] },
  config: Record<string, unknown> = {},
): StepDefinition {
  return {
    id: step.id,
    name: step.name,
    type: step.type,
    config,
    dependsOn: step.dependsOn,
  };
}

function getStepRange(from: string, to: string | undefined): typeof STEP_CATALOG {
  const fromIdx = STEP_CATALOG.findIndex((s) => s.id === from);
  if (fromIdx === -1) {
    console.error(`Unknown step: ${from}`);
    console.error(`Available: ${STEP_CATALOG.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }
  if (to === undefined) {
    return STEP_CATALOG.slice(fromIdx, fromIdx + 1);
  }
  const toIdx = STEP_CATALOG.findIndex((s) => s.id === to);
  if (toIdx === -1) {
    console.error(`Unknown step: ${to}`);
    console.error(`Available: ${STEP_CATALOG.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }
  if (toIdx < fromIdx) {
    console.error(`"to" (${to}) must come after "from" (${from})`);
    process.exit(1);
  }
  return STEP_CATALOG.slice(fromIdx, toIdx + 1);
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdStatus(key: string): Promise<void> {
  const state = await getState(key);
  printStatus(state);
}

async function cmdAdd(key: string, type: string, flags: Record<string, string>): Promise<void> {
  const catalogStep = STEP_CATALOG.find((s) => s.type === type || s.id === type);
  if (catalogStep === undefined) {
    console.error(`Unknown step type: ${type}`);
    console.error(`Available: ${STEP_CATALOG.map((s) => `${s.id} (${s.type})`).join(", ")}`);
    process.exit(1);
  }
  const id = flags.id ?? catalogStep.id;
  let config: Record<string, unknown> = {};
  if (flags.config !== undefined) {
    try {
      config = JSON.parse(flags.config);
    } catch {
      console.error(`Invalid JSON in --config: ${flags.config}`);
      process.exit(1);
    }
  }
  await addStep(key, makeStepDef({ ...catalogStep, id }, config));
  console.log(`✓ Added step "${id}" (type=${catalogStep.type}) to pipeline "${key}"`);
}

async function cmdAddAll(key: string, flags: Record<string, string>): Promise<void> {
  const inputPath = flags.input;
  if (inputPath === undefined) {
    console.error("--input <path> is required for add-all (needed by normalize step)");
    process.exit(1);
  }
  for (const step of STEP_CATALOG) {
    const config = step.id === "normalize" ? { inputPath } : {};
    await addStep(key, makeStepDef(step, config));
  }
  console.log(`✓ Added all 15 steps to pipeline "${key}"`);
}

async function cmdAddRange(key: string, flags: Record<string, string>): Promise<void> {
  if (flags.from === undefined) {
    console.error("--from <step> is required for add-range");
    process.exit(1);
  }
  const range = getStepRange(flags.from, flags.to);
  const inputPath = flags.input;
  for (const step of range) {
    const config = step.id === "normalize" && inputPath !== undefined ? { inputPath } : {};
    await addStep(key, makeStepDef(step, config));
  }
  console.log(`✓ Added ${range.length} step(s) to pipeline "${key}": ${range.map((s) => s.id).join(" → ")}`);
}

async function cmdRun(key: string, flags: Record<string, string>): Promise<void> {
  const state = await getState(key);
  if (state.steps.length === 0) {
    console.error(`Pipeline "${key}" has no steps. Add steps first with 'add' or 'add-all'.`);
    process.exit(1);
  }

  // If --from/--to specified, mark steps outside the range as skipped
  // so the run loop only executes the requested slice.
  if (flags.from !== undefined || flags.to !== undefined) {
    const fromId = flags.from ?? STEP_CATALOG[0]!.id;
    const toId = flags.to ?? STEP_CATALOG[STEP_CATALOG.length - 1]!.id;
    const range = getStepRange(fromId, toId);
    const rangeIds = new Set(range.map((s) => s.id));

    for (const step of state.steps) {
      if (!rangeIds.has(step.definition.id) && step.status === "pending") {
        await skipStep(key, step.definition.id);
      }
    }
  }

  console.log(`▶ Starting pipeline "${key}"...`);
  await startPipeline(key);

  // Watch until terminal
  const timeout = flags.timeout !== undefined ? parseInt(flags.timeout, 10) : 300_000;
  await cmdWatch(key, timeout);
}

async function cmdWatch(key: string, timeoutMs: number): Promise<void> {
  const startTime = Date.now();
  let lastRunning = "";
  while (Date.now() - startTime < timeoutMs) {
    const state = await getState(key);
    const completed = state.steps.filter((s) => s.status === "completed").length;
    const failed = state.steps.filter((s) => s.status === "failed").length;
    const running = state.steps.find((s) => s.status === "running");
    const runningId = running?.definition.id ?? "-";
    const elapsed = running?.startedAt !== undefined
      ? `${((Date.now() - running.startedAt) / 1000).toFixed(1)}s`
      : "";
    // Update every poll when a step is running (show live elapsed time)
    if (runningId !== lastRunning || running !== undefined || state.status === "completed" || state.status === "failed") {
      process.stdout.write(`\r  ${state.status.padEnd(10)} ${completed}/${state.steps.length} done, ${failed} failed, running=${runningId} ${elapsed}    `);
      lastRunning = runningId;
    }
    if (state.status === "completed" || state.status === "failed") {
      console.log();
      printStatus(state);
      if (state.status === "failed") {
        const failedSteps = state.steps.filter((s) => s.status === "failed");
        for (const s of failedSteps) {
          console.log(`  ✗ ${s.definition.id}: ${s.error ?? "unknown error"}`);
        }
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\n  ⏱ Timed out after ${timeoutMs}ms`);
}

async function cmdResult(key: string, stepId: string): Promise<void> {
  const state = await getState(key);
  const step = state.steps.find((s) => s.definition.id === stepId);
  if (step === undefined) {
    console.error(`Step "${stepId}" not found in pipeline "${key}"`);
    console.error(`Available: ${state.steps.map((s) => s.definition.id).join(", ")}`);
    process.exit(1);
  }
  printResult(step);
}

async function cmdRunStep(key: string, stepId: string): Promise<void> {
  console.log(`▶ Running step "${stepId}" in pipeline "${key}"...`);
  const step = await runStep(key, stepId);
  console.log(`✓ Step "${stepId}": ${step.status}`);
  if (step.summary !== undefined) console.log(`  ${step.summary}`);
  if (step.error !== undefined) console.log(`  ⚠ ${step.error}`);
}

async function cmdLogs(key: string, stepId: string): Promise<void> {
  const logs = await getStepLogs(key, stepId);
  console.log(`\n  Logs for step "${stepId}" (${logs.length} events):\n`);
  for (const event of logs) {
    const e = event as { type?: string; label?: string; detail?: string; elapsed?: number; chunkIndex?: number; timestamp?: number };
    const time = e.timestamp !== undefined ? new Date(e.timestamp).toISOString().slice(11, 19) : "?";
    const elapsed = e.elapsed !== undefined ? ` ${e.elapsed}s` : "";
    const chunk = e.chunkIndex !== undefined ? ` #${e.chunkIndex}` : "";
    const detail = e.detail !== undefined ? ` ${e.detail}` : "";
    console.log(`  [${time}] ${e.type ?? "?"} ${e.label ?? ""}${elapsed}${chunk}${detail}`);
  }
  console.log();
}

async function cmdInvalidate(key: string, stepId: string): Promise<void> {
  const steps = await invalidateStep(key, stepId);
  const stale = steps.filter((s) => s.status === "stale");
  console.log(`⚠ Invalidated step "${stepId}" + ${stale.length} downstream step(s):`);
  for (const s of stale) {
    console.log(`  ⚠ ${s.definition.id}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { cmd, positional, flags } = parseArgs(process.argv);

  try {
    switch (cmd) {
      case "status": {
        if (positional.length < 1) { console.error("Usage: status <key>"); process.exit(1); }
        await cmdStatus(positional[0]!);
        break;
      }
      case "run": {
        if (positional.length < 1) { console.error("Usage: run <key> [--from <step>] [--to <step>]"); process.exit(1); }
        await cmdRun(positional[0]!, flags);
        break;
      }
      case "add": {
        if (positional.length < 2) { console.error("Usage: add <key> <type> [--id <id>] [--config <json>]"); process.exit(1); }
        await cmdAdd(positional[0]!, positional[1]!, flags);
        break;
      }
      case "add-all": {
        if (positional.length < 1) { console.error("Usage: add-all <key> --input <path>"); process.exit(1); }
        await cmdAddAll(positional[0]!, flags);
        break;
      }
      case "add-range": {
        if (positional.length < 1) { console.error("Usage: add-range <key> --from <step> [--to <step>] [--input <path>]"); process.exit(1); }
        await cmdAddRange(positional[0]!, flags);
        break;
      }
      case "pause": {
        if (positional.length < 1) { console.error("Usage: pause <key>"); process.exit(1); }
        await pausePipeline(positional[0]!);
        console.log(`⏸ Paused pipeline "${positional[0]!}"`);
        break;
      }
      case "resume": {
        if (positional.length < 1) { console.error("Usage: resume <key>"); process.exit(1); }
        await resumePipeline(positional[0]!);
        console.log(`▶ Resumed pipeline "${positional[0]!}"`);
        break;
      }
      case "retry": {
        if (positional.length < 2) { console.error("Usage: retry <key> <stepId>"); process.exit(1); }
        const step = await retryStep(positional[0]!, positional[1]!);
        console.log(`↻ Retried step "${positional[1]!}": ${step.status}`);
        break;
      }
      case "skip": {
        if (positional.length < 2) { console.error("Usage: skip <key> <stepId>"); process.exit(1); }
        const step = await skipStep(positional[0]!, positional[1]!);
        console.log(`→ Skipped step "${positional[1]!}": ${step.status}`);
        break;
      }
      case "result": {
        if (positional.length < 2) { console.error("Usage: result <key> <stepId>"); process.exit(1); }
        await cmdResult(positional[0]!, positional[1]!);
        break;
      }
      case "run-step": {
        if (positional.length < 2) { console.error("Usage: run-step <key> <stepId>"); process.exit(1); }
        await cmdRunStep(positional[0]!, positional[1]!);
        break;
      }
      case "logs": {
        if (positional.length < 2) { console.error("Usage: logs <key> <stepId>"); process.exit(1); }
        await cmdLogs(positional[0]!, positional[1]!);
        break;
      }
      case "invalidate": {
        if (positional.length < 2) { console.error("Usage: invalidate <key> <stepId>"); process.exit(1); }
        await cmdInvalidate(positional[0]!, positional[1]!);
        break;
      }
      case "watch": {
        if (positional.length < 1) { console.error("Usage: watch <key> [--timeout <ms>]"); process.exit(1); }
        const timeout = flags.timeout !== undefined ? parseInt(flags.timeout, 10) : 300_000;
        await cmdWatch(positional[0]!, timeout);
        break;
      }
      default:
        console.error(`Unknown command: ${cmd}`);
        printUsage();
        process.exit(1);
    }
  } catch (e) {
    console.error(`\n✗ Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

main();
