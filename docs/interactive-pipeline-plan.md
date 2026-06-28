# Interactive Pipeline Architecture Plan

## Vision

An n8n-style interactive workflow where each pipeline step is an observable, independently controllable node. Users see live progress (streaming LLM tokens, substep completion), can pause/resume, run single steps, retry failed ones, and the system automatically detects which downstream steps are stale when an upstream step is re-run.

## Current State

- 15 step executors in a linear chain (CLI catalog defines `dependsOn`)
- Each step calls adapters via `PipelineBridge`, gets inputs from `previousResults` map
- Progress events (`StepProgressEvent`) broadcast via `rawRivetkitContext.broadcast("stepProgress", ...)`
- Actor processes actions serially → `GetStatus` blocks during step execution (the timeout problem)
- Step results stored in actor state (`StepState.result: unknown`) — not queryable independently
- LLM streaming: `streamText` gives token-by-token but no schema enforcement; `streamObject` enforces schema but buffers to 1-2 chunks

## Architecture Changes

### 1. Step DAG with Input/Output Contracts

**Problem:** Steps currently use an ad-hoc `previousResults: Map<string, unknown>` with hand-written type guards. Dependencies are declared in the CLI catalog, not in the step executors themselves. No way to know which steps are affected when one is re-run.

**Solution:** Each step executor declares its inputs and outputs as typed contracts.

```typescript
interface StepExecutor {
  readonly type: string;
  readonly inputs: readonly string[];   // step IDs this step consumes results from
  readonly outputs: readonly string[];  // output keys this step produces (e.g. "transcript", "storyPlan")
  execute(ctx: StepContext): Effect.Effect<StepOutput, Error, unknown>;
}

interface StepOutput {
  /** Stable hash of all inputs that produced this output. */
  inputHash: string;
  /** The actual result data, keyed by output name. */
  data: Record<string, unknown>;
  /** Human-readable summary for UI display. */
  summary: string;
}
```

The DAG is derived from `inputs` declarations — no separate catalog needed. The run loop topologically sorts steps by their `inputs` and executes in dependency order, running independent branches in parallel.

**Stale detection:** When a step is re-run, its `inputHash` changes. All downstream steps that consume this step's outputs are marked `stale`. A stale step can be:
- Re-run (produces fresh output from new upstream)
- Accepted as-is (user keeps the old output, downstream stays stale)
- Force-re-run (cascade: re-run all stale downstream steps)

### 2. Step State Machine

```
pending → running → completed
                 → failed → retry → running
         → skipped (user manually skips)
completed → stale (upstream changed) → pending (user triggers re-run)
```

New `StepStatus` values: add `"stale"`.

Each `StepState` gains:
```typescript
{
  // ...existing fields...
  inputHash?: string;        // hash of inputs when this step last ran
  outputKeys?: string[];     // what outputs this step produced
  summary?: string;          // human-readable result summary for UI
  logs?: LogEntry[];         // recent log/progress entries (ring buffer, last N)
}
```

### 3. Separate Control Plane from Execution Plane

**Problem:** The actor runs steps in a forked fiber, but the action queue is serial. `GetStatus` can't be processed while a step is executing. This is why `status` times out during `plan_story`.

**Solution:** The run loop runs in a detached fiber (`Effect.forkDaemon`). The actor's action handlers only touch `State` (reads/updates), which is non-blocking. The run loop checks a **pause flag** in state between steps and between sub-iterations within a step.

Key changes to `live.ts`:
- `Start` action: forks the run loop as a daemon fiber, stores the fiber reference in a mutable ref
- `GetStatus`: just reads state — always fast, never blocks
- `Pause`: sets `status: "paused"` in state — the run loop checks this between steps and stops
- `Resume`: forks a new run loop that skips already-completed steps
- `RunStep` (new action): runs a single step in isolation, using cached upstream outputs
- `RetryStep`: marks step as `pending` and forks a single-step execution

The run loop's inner iteration checks `state.status` before each step, enabling pause between steps. For mid-step pause (e.g. during a long LLM call), steps can check `ctx.shouldAbort()` — an `AbortController` signal set by `Pause`.

### 4. New Actor Actions

```typescript
// Existing (keep):
GetStatus, AddStep, RemoveStep, Start, Pause, Resume, SkipStep, Schedule

// New:
RunStep        // Run a single step by ID (uses cached upstream outputs)
RetryStep      // Re-run a step (marks downstream as stale)
GetStepResult  // Get a specific step's output data (not just status)
GetStepLogs    // Get recent log/progress entries for a step
InvalidateStep // Manually mark a step + downstream as stale
```

### 5. Fix LLM Streaming: streamObject fullStream

**Problem:** `streamText` + `responseFormat: { type: 'json' }` = valid JSON but wrong schema shape. `streamObject` + `partialObjectStream` = correct schema but 1-2 chunks (buffers until parseable). Neither gives both token-by-token visibility AND schema enforcement.

**Solution:** `streamObject` exposes a `fullStream` that includes `{ type: 'text-delta', textDelta: '...' }` events alongside partial-object events. Use `fullStream` to:
1. Emit `llm_chunk` events with the raw text delta for UI display (token-by-token)
2. Let `streamObject` handle schema enforcement (sends zod schema to model via `structured_outputs`)
3. Await the `object` promise for the final validated result

```typescript
const { fullStream, object } = streamObject<T>({ ...opts });
for await (const event of fullStream) {
  if (event.type === 'text-delta') {
    tokenCount++;
    fullText += event.textDelta;
    if (tokenCount % 10 === 0) {
      emit?.({ type: 'llm_chunk', label, chunkIndex: tokenCount, ... });
    }
  }
}
const result = await object;  // schema-validated
```

This gives real token streaming for the UI AND correct structured output. No fallback to `generateObject` needed.

### 6. Step Output Persistence

Each step's output is stored in two places:
- **Actor state** (`StepState.result`): the full output object, used by downstream steps
- **Output store** (filesystem under `UPLOAD_DIR/outputs/<pipelineId>/<stepId>/`): large outputs (images, audio files) stored as files, with paths in the state result

This enables:
- `GetStepResult` action returns the output without re-running
- UI can display intermediate results (transcript text, story plan JSON, rendered images)
- Downstream steps can run from cached outputs without re-running upstream

### 7. Progress Event Log per Step

Currently progress events are fire-and-forget broadcasts. Add a ring buffer per step in actor state:

```typescript
// In StepState:
progressEvents?: StepProgressEvent[];  // last 100 events
```

The `emit` callback both broadcasts AND appends to the ring buffer. `GetStepLogs` action returns this buffer. UI can show:
- Live streaming (via broadcast subscription)
- Historical progress (via GetStepLogs, for steps that already completed)

### 8. UI: n8n-style Flow Chart

React app using React Flow (or similar DAG visualization):

**Node states (visual):**
- pending (gray)
- running (blue, pulsing)
- completed (green)
- failed (red)
- skipped (gray, strikethrough)
- stale (orange)

**Node content:**
- Step name + type
- Status icon
- Duration (if completed)
- Summary (if completed — e.g. "3 sections, 5 characters")
- Live progress bar (if running — current/total)
- Streaming text preview (if running + LLM step — last N tokens)

**Interactions:**
- Click node → side panel with full output, logs, progress timeline
- Right-click node → context menu: Run, Retry, Skip, Invalidate
- Drag to rearrange (cosmetic only, DAG structure is fixed by inputs)
- Global controls: Run All, Pause, Resume

**Live updates:**
- WebSocket/SSE subscription to `stepProgress` events
- Each event routed to the corresponding node by `stepId`
- `llm_chunk` events update a streaming text area in the node
- `substep_start/done` events update progress bars
- `stepCompleted`/`stepFailed` events change node color

## Implementation Phases

### Phase 1: Fix LLM Streaming (smallest, highest impact)
- Replace `streamText` with `streamObject` + `fullStream` in `streamObjectWithProgress`
- Get token-by-token streaming WITH schema enforcement
- Test: run `plan_story` in isolation, see live tokens + correct structured output

### Phase 2: Step DAG & Input Contracts
- Add `inputs`/`outputs` declarations to each `StepExecutor`
- Replace `previousResults: Map<string, unknown>` with typed input resolution
- Topological sort in run loop (instead of fixed order)
- Add `inputHash` computation (hash of upstream output data)
- Add `stale` status + cascade invalidation

### Phase 3: Control/Execution Separation
- Fork run loop as daemon fiber
- Make `GetStatus` non-blocking (already just reads state, but verify)
- Add `RunStep` action (single step isolation)
- Add `AbortController` for mid-step pause
- Add `GetStepResult` and `GetStepLogs` actions
- Add progress event ring buffer per step

### Phase 4: CLI Updates
- `run-step <key> <stepId>` — run single step
- `result <key> <stepId>` — show step output (already exists, wire to new action)
- `logs <key> <stepId>` — show step progress events
- `invalidate <key> <stepId>` — mark step + downstream as stale
- Fix `status` timeout (should be instant now with control/exec separation)

### Phase 5: UI
- React Flow DAG visualization
- Node states + live progress
- Side panel for step details (output, logs, streaming)
- Controls (run, pause, retry, run-single, invalidate)
- WebSocket subscription to `stepProgress` events

## Key Design Decisions

1. **DAG not linear chain:** Steps declare `inputs` (which step IDs they consume). The run loop topologically sorts and runs independent branches in parallel. This is already partially true (build_bibles and section_memory both depend on plan_story but not each other).

2. **Input hashing for staleness:** Hash the JSON of all upstream outputs a step consumes. If the hash differs from when the step last ran, the step is stale. This handles both "upstep re-ran with different result" and "upstream config changed" cases.

3. **Daemon fiber for execution:** The run loop is a daemon fiber, not blocking the action queue. Actions only touch state (reads/writes), which is atomic and non-blocking. This fixes the GetStatus timeout permanently.

4. **streamObject fullStream for LLM:** Gets both token-by-token visibility (via `text-delta` events) and schema enforcement (via zod schema sent to model). No more fallback to generateObject.

5. **Ring buffer for progress events:** Last 100 events per step, stored in actor state. Enables historical view without re-running. Broadcast still happens for live updates.

6. **Output store on filesystem:** Large outputs (images, audio) stored as files, paths in state. Small outputs (JSON, text) stored directly in state. `GetStepResult` returns metadata + either inline data or file path.
