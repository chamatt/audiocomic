import { Actor, State } from "@rivetkit/effect";
import { Cause, Duration, Effect, Exit, Schedule } from "effect";
import { Pipeline, PipelineState } from "./api.ts";
import { getStepExecutor, type StepContext, type StepOutput } from "./steps/types.ts";
// Side-effect import: registers all 15 step executors in the global registry.
import "./steps/index.ts";
import type { RetryPolicy, StepState } from "../../lib/schemas.ts";
import { createDefaultSteps } from "./default-steps.ts";
import { logAndDie } from "../../lib/services.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default retry policy when a step doesn't define its own. */
const DEFAULT_RETRY: RetryPolicy = {
	maxRetries: 3,
	backoffMs: 1000,
	backoffFactor: 2,
};

/**
 * Build the step-execution effect with optional timeout (per attempt) and
 * retry schedule. Timeout is applied before retry so each attempt is bounded;
 * a timeout becomes a failure so the retry schedule can catch it.
 */
function withRetryAndTimeout(
	execEffect: Effect.Effect<StepOutput, Error, unknown>,
	retryPolicy: RetryPolicy | undefined,
	stepId: string,
): Effect.Effect<StepOutput, Error | Cause.TimeoutError, unknown> {
	const rp = retryPolicy ?? DEFAULT_RETRY;

	let effect = execEffect;

	if (rp.timeoutMs !== undefined) {
		effect = effect.pipe(Effect.timeout(Duration.millis(rp.timeoutMs)));
	}

	const backoff = Schedule.exponential(
		Duration.millis(rp.backoffMs),
		rp.backoffFactor,
	);

	return effect.pipe(
		Effect.retry(Schedule.both(backoff, Schedule.recurs(rp.maxRetries))),
	);
}

/** Find a step by ID, returning the step and its index. */
function findStep(
	steps: readonly StepState[],
	stepId: string,
): { idx: number; step: StepState } | undefined {
	const idx = steps.findIndex((s) => s.definition.id === stepId);
	if (idx === -1) return undefined;
	return { idx, step: steps[idx]! };
}

/**
 * Topologically sort steps by their executor's `inputs` declarations.
 * Steps with no inputs come first; steps with inputs come after all their deps.
 * Independent branches can execute in any order relative to each other.
 */
function topoSort(steps: readonly StepState[]): StepState[] {
	const stepMap = new Map(steps.map((s) => [s.definition.id, s]));
	const visited = new Set<string>();
	const result: StepState[] = [];

	function visit(id: string): void {
		if (visited.has(id)) return;
		visited.add(id);
		const step = stepMap.get(id);
		if (step === undefined) return;
		const executor = getStepExecutor(step.definition.type);
		if (executor !== undefined) {
			for (const dep of executor.inputs) {
				visit(dep);
			}
		}
		result.push(step);
	}

	for (const s of steps) {
		visit(s.definition.id);
	}

	return result;
}

/**
 * Compute a hash of all upstream step outputs that a step consumes.
 * Used for stale detection — if the hash changes, the step is stale.
 */
function computeInputHash(
	stepId: string,
	steps: readonly StepState[],
): string {
	const executor = getStepExecutor(steps.find((s) => s.definition.id === stepId)?.definition.type ?? "");
	if (executor === undefined) return "";

	const parts: string[] = [];
	for (const inputId of executor.inputs) {
		const inputStep = findStep(steps, inputId);
		if (inputStep !== undefined && inputStep.step.status === "completed") {
			// Hash the input step's result + its own inputHash (transitive)
			parts.push(`${inputId}:${inputStep.step.inputHash ?? ""}:${JSON.stringify(inputStep.step.result)}`);
		}
	}
	// Simple hash — djb2
	const str = parts.join("|");
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
	}
	return hash.toString(36);
}

/**
 * Find all downstream steps that depend (transitively) on the given step ID.
 * Used for cascade invalidation when a step is re-run.
 */
function findDownstream(
	stepId: string,
	steps: readonly StepState[],
): string[] {
	const downstream: string[] = [];
	const visited = new Set<string>();

	function visit(id: string): void {
		if (visited.has(id)) return;
		visited.add(id);
		for (const s of steps) {
			const executor = getStepExecutor(s.definition.type);
			if (executor !== undefined && executor.inputs.includes(id)) {
				if (!downstream.includes(s.definition.id)) {
					downstream.push(s.definition.id);
				}
				visit(s.definition.id);
			}
		}
	}

	visit(stepId);
	return downstream;
}

/** Maximum progress events to retain per step (ring buffer). */
const MAX_PROGRESS_EVENTS = 100;

/** Append a progress event to a step's ring buffer. */
function appendProgressEvent(
	step: StepState,
	event: unknown,
): unknown[] {
	const existing = step.progressEvents ?? [];
	const updated = [...existing, event];
	if (updated.length > MAX_PROGRESS_EVENTS) {
		return updated.slice(updated.length - MAX_PROGRESS_EVENTS);
	}
	return updated;
}

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

/**
 * Live implementation of the `Pipeline` actor.
 *
 * The run loop is forked as a daemon fiber so action handlers (GetStatus,
 * Pause, etc.) remain responsive while steps execute. The loop checks
 * `state.status` between steps to support pause/resume.
 */
export const PipelineLive = Pipeline.toLayer(
	({ rawRivetkitContext, state }) => {
		// Mutable ref for abort flag — checked by steps via ctx.shouldAbort.
		let paused = false;

		// -------------------------------------------------------------------
		// Core step execution helper — shared by runLoop, RunStep, RetryStep.
		// -------------------------------------------------------------------

		function executeStep(
			stepId: string,
			steps: readonly StepState[],
		): Effect.Effect<StepOutput, Error, unknown> {
			return Effect.gen(function* () {
				const found = findStep(steps, stepId);
				if (found === undefined) {
					return yield* Effect.die(new Error(`Step not found: ${stepId}`));
				}
				const { step } = found;

				const executor = getStepExecutor(step.definition.type);
				if (executor === undefined) {
					return yield* Effect.die(
						new Error(`No executor for step type: ${step.definition.type}`),
					);
				}

				// Build previousResults from completed steps.
				const previousResults = new Map<string, unknown>();
				for (const s of steps) {
					if (s.status === "completed" && s.result !== undefined) {
						// Unwrap StepOutput if needed (result may be StepOutput or raw)
						const result = s.result as { data?: unknown } | unknown;
						if (typeof result === "object" && result !== null && "data" in result && "inputHash" in result) {
							previousResults.set(s.definition.id, (result as StepOutput).data);
						} else {
							previousResults.set(s.definition.id, result);
						}
					}
				}

				// Compute input hash for stale detection.
				const inputHash = computeInputHash(stepId, steps);

				const ctx: StepContext = {
					projectId: rawRivetkitContext.key[0] ?? rawRivetkitContext.actorId,
					pipelineId: rawRivetkitContext.actorId,
					stepId: step.definition.id,
					config: step.definition.config,
					inputHash,
					previousResults,
					rawRivetkitContext,
					emit: (event) => {
						const stamped = { ...event, timestamp: Date.now() };
						rawRivetkitContext.broadcast("stepProgress", {
							stepId: step.definition.id,
							...stamped,
						});
						// Also append to ring buffer in state.
						// Also append to ring buffer in state (fire-and-forget).
						Effect.runFork(State.updateAndGet(state, (s) => ({
							...s,
							steps: s.steps.map((st) =>
								st.definition.id === stepId
									? { ...st, progressEvents: appendProgressEvent(st, stamped) }
									: st,
							),
						})));
					},
					shouldAbort: () => paused,
				};

				return yield* executor.execute(ctx);
			});
		}

		/** Mark a step as running, broadcast, return updated step. */
		function markRunning(stepId: string): Effect.Effect<StepState, never, unknown> {
			return Effect.gen(function* () {
				const updated = yield* State.updateAndGet(state, (s) => ({
					...s,
					steps: s.steps.map((st) =>
						st.definition.id === stepId
							? {
								...st,
								status: "running" as const,
								startedAt: Date.now(),
								attempts: st.attempts + 1,
								error: undefined,
							}
							: st,
					),
			})).pipe(logAndDie("pipeline.markRunning"));
				const found = findStep(updated.steps, stepId);
				return found?.step ?? updated.steps[0]!;
			});
		}

		/** Mark a step as completed with result, broadcast, return updated step. */
		function markCompleted(stepId: string, output: StepOutput): Effect.Effect<StepState, never, unknown> {
			return Effect.gen(function* () {
				const completed = yield* State.updateAndGet(state, (s) => ({
					...s,
					steps: s.steps.map((st) =>
						st.definition.id === stepId
							? {
								...st,
								status: "completed" as const,
								completedAt: Date.now(),
								result: output,
								inputHash: output.inputHash,
								summary: output.summary,
							}
							: st,
					),
			})).pipe(logAndDie("pipeline.markCompleted"));
				const found = findStep(completed.steps, stepId);
				rawRivetkitContext.broadcast("stepCompleted", found?.step);
				return found?.step ?? completed.steps[0]!;
			});
		}

		/** Mark a step as failed with error, broadcast, return updated step. */
		function markFailed(stepId: string, errorMsg: string): Effect.Effect<StepState, never, unknown> {
			return Effect.gen(function* () {
				const failed = yield* State.updateAndGet(state, (s) => ({
					...s,
					steps: s.steps.map((st) =>
						st.definition.id === stepId
							? {
								...st,
								status: "failed" as const,
								error: errorMsg,
								completedAt: Date.now(),
							}
							: st,
					),
			})).pipe(logAndDie("pipeline.markFailed"));
				const found = findStep(failed.steps, stepId);
				rawRivetkitContext.broadcast("stepFailed", found?.step);
				return found?.step ?? failed.steps[0]!;
			});
		}

		/** Cascade invalidation: mark all downstream steps as stale. */
		function invalidateDownstream(stepId: string): Effect.Effect<readonly StepState[], never, unknown> {
			return Effect.gen(function* () {
				const updated = yield* State.updateAndGet(state, (s) => {
					const downstream = findDownstream(stepId, s.steps);
					return {
						...s,
						steps: s.steps.map((st) =>
							downstream.includes(st.definition.id) && st.status === "completed"
								? { ...st, status: "stale" as const }
								: st,
						),
					};
			}).pipe(logAndDie("pipeline.invalidateDownstream"));
				return updated.steps;
			});
		}

		// -------------------------------------------------------------------
		// Step execution loop — forked into the actor scope by Start/Resume.
		// Uses topological sort based on executor inputs declarations.
		// -------------------------------------------------------------------
		const runLoop: Effect.Effect<string, never, unknown> = Effect.gen(function* () {
			const initial = yield* logAndDie("pipeline.runLoop.init")(State.get(state));
			rawRivetkitContext.broadcast("pipelineStarted", initial);

			// Topologically sort steps by their executor inputs.
			const sortedSteps = topoSort(initial.steps);
			const stepIds = sortedSteps.map((s) => s.definition.id);

			for (const stepId of stepIds) {
				// Check for pause between steps.
				const current = yield* logAndDie("pipeline.runLoop.pauseCheck")(State.get(state));
				if (current.status !== "running") {
					return current.status;
				}

				const found = findStep(current.steps, stepId);
				if (found === undefined) continue; // step removed mid-run
				const { idx, step } = found;

				// Skip steps that are already terminal.
				if (
					step.status === "completed" ||
					step.status === "skipped" ||
					step.status === "failed"
				) {
					continue;
				}

				// Skip stale steps — they need explicit re-run by user.
				if (step.status === "stale") {
					continue;
				}

				// Dependency check — every declared dep must be completed or skipped.
				const executor = getStepExecutor(step.definition.type);
				if (executor !== undefined) {
					const depsMet = executor.inputs.every((depId) => {
						const dep = findStep(current.steps, depId);
						return (
							dep !== undefined &&
							(dep.step.status === "completed" || dep.step.status === "skipped")
						);
					});
					if (!depsMet) {
						const blocked = yield* State.updateAndGet(state, (s) => ({
							...s,
							steps: s.steps.map((st) =>
								st.definition.id === stepId
									? {
										...st,
										status: "failed" as const,
										error: `Unmet dependencies: ${executor.inputs.join(", ")}`,
										completedAt: Date.now(),
									}
									: st,
							),
					})).pipe(logAndDie("pipeline.runLoop.depBlocked"));
						rawRivetkitContext.broadcast("stepFailed", blocked.steps[idx]);
						continue;
					}
				}

				// Mark step as running.
				const runningState = yield* markRunning(stepId);
				rawRivetkitContext.broadcast("stepStarted", runningState);

				// Execute with retry + timeout.
				const freshState = yield* logAndDie("pipeline.runLoop.preExec")(State.get(state));
				const execEffect = withRetryAndTimeout(
					executeStep(stepId, freshState.steps),
					step.definition.retryPolicy,
					step.definition.id,
				);
				const exit = yield* execEffect.pipe(Effect.exit);

				if (Exit.isSuccess(exit)) {
					yield* markCompleted(stepId, exit.value);
					// Auto-pause if this step has pauseAfter flag.
					if (step.definition.pauseAfter === true) {
						const pausedState = yield* State.updateAndGet(state, (s) => ({
							...s,
							status: "paused" as const,
					})).pipe(logAndDie("pipeline.runLoop.autoPause"));
						rawRivetkitContext.broadcast("pipelinePaused", pausedState);
						yield* Effect.logInfo(
							`Pipeline auto-paused after step: ${stepId} — review output then click Resume`,
						);
						return "paused";
					}

				} else {
					const squashed = Cause.squash(exit.cause);
					const errorMsg = squashed instanceof Error
						? squashed.message
						: String(squashed);
					yield* markFailed(stepId, errorMsg);

					// A failed step halts the pipeline.
					const halted = yield* State.updateAndGet(state, (s) => ({
						...s,
						status: "failed" as const,
				})).pipe(logAndDie("pipeline.runLoop.halted"));
					rawRivetkitContext.broadcast("pipelineCompleted", halted);
					return halted.status;
				}
			}

			// All steps processed — determine final status.
			const finalState = yield* logAndDie("pipeline.runLoop.final")(State.get(state));
			const allDone = finalState.steps.every(
				(s) => s.status === "completed" || s.status === "skipped",
			);
			const finalStatus = allDone ? "completed" : "failed";
			const done = yield* State.updateAndGet(state, (s) => ({
				...s,
				status: finalStatus as "completed" | "failed",
			})).pipe(logAndDie("pipeline.runLoop.done"));
			rawRivetkitContext.broadcast("pipelineCompleted", done);
			return done.status;
		});

		// -------------------------------------------------------------------
		// Action handlers
		// -------------------------------------------------------------------

		return {
			// -- Step management -------------------------------------------------

			AddStep: ({ payload }) =>
				Effect.gen(function* () {
					const newStep: StepState = {
						definition: payload.step,
						status: "pending",
						attempts: 0,
					};
					const updated = yield* State.updateAndGet(state, (s) => ({
						...s,
						steps: [...s.steps, newStep],
				})).pipe(logAndDie("pipeline.AddStep"));
					return updated.steps;
				}),

			RemoveStep: ({ payload }) =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(state, (s) => ({
						...s,
						steps: s.steps.filter(
							(st) => st.definition.id !== payload.stepId,
						),
				})).pipe(logAndDie("pipeline.RemoveStep"));
					return updated.steps;
				}),

			GetStatus: () =>
				Effect.gen(function* () {
				return yield* logAndDie("pipeline.GetStatus")(State.get(state));
				}),

			// -- Lifecycle -------------------------------------------------------

			Start: () =>
				Effect.gen(function* () {
					paused = false;
					const updated = yield* State.updateAndGet(state, (s) => ({
						...s,
						status: "running" as const,
				})).pipe(logAndDie("pipeline.Start"));
					// Fork the execution loop as a daemon so actions stay responsive.
					yield* runLoop.pipe(Effect.forkDetach);
					return updated.status;
				}),

			Pause: () =>
				Effect.gen(function* () {
					paused = true;
					const updated = yield* State.updateAndGet(state, (s) => ({
						...s,
						status: "paused" as const,
				})).pipe(logAndDie("pipeline.Pause"));
					rawRivetkitContext.broadcast("pipelinePaused", updated);
					return updated.status;
				}),

			Resume: () =>
				Effect.gen(function* () {
					paused = false;
					const updated = yield* State.updateAndGet(state, (s) => ({
						...s,
						status: "running" as const,
				})).pipe(logAndDie("pipeline.Resume"));
					rawRivetkitContext.broadcast("pipelineResumed", updated);
					yield* runLoop.pipe(Effect.forkDetach);
					return updated.status;
				}),

			// -- Per-step operations --------------------------------------------

			RetryStep: ({ payload }) =>
				Effect.gen(function* () {
				const current = yield* logAndDie("pipeline.RetryStep.getState")(State.get(state));
					const found = findStep(current.steps, payload.stepId);
					if (found === undefined) {
						return yield* Effect.die(
							new Error(`Step not found: ${payload.stepId}`),
						);
					}
					const { step } = found;

					// Mark as running.
					const runningState = yield* markRunning(payload.stepId);
					rawRivetkitContext.broadcast("stepStarted", runningState);

					// Execute the single step.
				const freshState = yield* logAndDie("pipeline.RetryStep.preExec")(State.get(state));
					const execEffect = withRetryAndTimeout(
						executeStep(payload.stepId, freshState.steps),
						step.definition.retryPolicy,
						payload.stepId,
					);
					const exit = yield* execEffect.pipe(Effect.exit);

					if (Exit.isSuccess(exit)) {
						const completed = yield* markCompleted(payload.stepId, exit.value);
						// Cascade: mark downstream as stale.
						yield* invalidateDownstream(payload.stepId);
						return completed;
					}

					const squashed = Cause.squash(exit.cause);
					const errorMsg = squashed instanceof Error
						? squashed.message
						: String(squashed);
					return yield* markFailed(payload.stepId, errorMsg);
				}),

			SkipStep: ({ payload }) =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(state, (s) => {
						const idx = s.steps.findIndex(
							(st) => st.definition.id === payload.stepId,
						);
						if (idx === -1) return s;
						const steps = [...s.steps];
						const target = steps[idx];
						if (target === undefined) return s;
						steps[idx] = {
							...target,
							status: "skipped" as const,
							completedAt: Date.now(),
						};
						return { ...s, steps };
				}).pipe(logAndDie("pipeline.SkipStep"));
					const found = findStep(updated.steps, payload.stepId);
					if (found === undefined) {
						return yield* Effect.die(
							new Error(`Step not found: ${payload.stepId}`),
						);
					}
					return found.step;
				}),

			RunStep: ({ payload }) =>
				Effect.gen(function* () {
				const current = yield* logAndDie("pipeline.RunStep.getState")(State.get(state));
					const found = findStep(current.steps, payload.stepId);
					if (found === undefined) {
						return yield* Effect.die(
							new Error(`Step not found: ${payload.stepId}`),
						);
					}
					const { step } = found;

					// Mark as running.
					const runningState = yield* markRunning(payload.stepId);
					rawRivetkitContext.broadcast("stepStarted", runningState);

					// Execute the single step using cached upstream outputs.
				const freshState = yield* logAndDie("pipeline.RunStep.preExec")(State.get(state));
					const execEffect = withRetryAndTimeout(
						executeStep(payload.stepId, freshState.steps),
						step.definition.retryPolicy,
						payload.stepId,
					);
					const exit = yield* execEffect.pipe(Effect.exit);

					if (Exit.isSuccess(exit)) {
						const completed = yield* markCompleted(payload.stepId, exit.value);
						// Cascade: mark downstream as stale.
						yield* invalidateDownstream(payload.stepId);
						return completed;
					}

					const squashed = Cause.squash(exit.cause);
					const errorMsg = squashed instanceof Error
						? squashed.message
						: String(squashed);
					return yield* markFailed(payload.stepId, errorMsg);
				}),

			GetStepResult: ({ payload }) =>
				Effect.gen(function* () {
				const current = yield* logAndDie("pipeline.GetStepResult")(State.get(state));
					const found = findStep(current.steps, payload.stepId);
					if (found === undefined) {
						return yield* Effect.die(
							new Error(`Step not found: ${payload.stepId}`),
						);
					}
					return found.step.result;
				}),

			GetStepLogs: ({ payload }) =>
				Effect.gen(function* () {
				const current = yield* logAndDie("pipeline.GetStepLogs")(State.get(state));
					const found = findStep(current.steps, payload.stepId);
					if (found === undefined) {
						return yield* Effect.die(
							new Error(`Step not found: ${payload.stepId}`),
						);
					}
					return found.step.progressEvents ?? [];
				}),

			InvalidateStep: ({ payload }) =>
				Effect.gen(function* () {
					// Mark the step itself as stale, then cascade to downstream.
					const updated = yield* State.updateAndGet(state, (s) => {
						const downstream = findDownstream(payload.stepId, s.steps);
						const allIds = [payload.stepId, ...downstream];
						return {
							...s,
							steps: s.steps.map((st) =>
								allIds.includes(st.definition.id) && st.status === "completed"
									? { ...st, status: "stale" as const }
									: st,
							),
						};
				}).pipe(logAndDie("pipeline.InvalidateStep"));
					return updated.steps;
				}),

			// -- Cron scheduling -------------------------------------------------

			Schedule: ({ payload }) =>
				Effect.gen(function* () {
					const now = Date.now();
					const schedule = {
						enabled: true,
						intervalMs: payload.intervalMs,
						nextRunAt: now + payload.intervalMs,
					};
					const updated = yield* State.updateAndGet(state, (s) => ({
						...s,
						status: "scheduled" as const,
						schedule,
				})).pipe(logAndDie("pipeline.Schedule"));
					// Schedule the first cron tick.
					yield* Effect.promise(() =>
						rawRivetkitContext.schedule.after(
							payload.intervalMs,
							"_cronTick",
							{},
						),
					);
					return updated.schedule!;
				}),

			CancelSchedule: () =>
				Effect.gen(function* () {
					yield* State.updateAndGet(state, (s) => ({
						...s,
						schedule: undefined,
						...(s.status === "scheduled" ? { status: "idle" as const } : {}),
				})).pipe(logAndDie("pipeline.CancelSchedule"));
					return true;
				}),

			_cronTick: () =>
				Effect.gen(function* () {
				const current = yield* logAndDie("pipeline._cronTick.getState")(State.get(state));
					const sched = current.schedule;
					if (sched === undefined || !sched.enabled) {
						return current.status;
					}
					// Skip if a run is already in progress.
					if (current.status === "running" || current.status === "paused") {
						yield* Effect.promise(() =>
							rawRivetkitContext.schedule.after(
								sched.intervalMs,
								"_cronTick",
								{},
							),
						);
						return current.status;
					}
					// Start a new run.
					const updated = yield* State.updateAndGet(state, (s) => ({
						...s,
						status: "running" as const,
						schedule: {
							...sched,
							nextRunAt: Date.now() + sched.intervalMs,
						},
				})).pipe(logAndDie("pipeline._cronTick.startRun"));
					yield* runLoop.pipe(Effect.forkDetach);
					yield* Effect.promise(() =>
						rawRivetkitContext.schedule.after(
							sched.intervalMs,
							"_cronTick",
							{},
						),
					);
					return updated.status;
				}),
		};
	},
	{
		state: {
			schema: PipelineState,
			initialValue: () => ({
				status: "idle" as const,
				steps: createDefaultSteps(),
				schedule: undefined,
			}),
		},
	},
);
