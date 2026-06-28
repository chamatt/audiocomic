import { Actor, State } from "@rivetkit/effect";
import { Cause, Duration, Effect, Exit, Schedule } from "effect";
import { Pipeline, PipelineState } from "./api.ts";
import { getStepExecutor, type StepContext } from "./steps/types.ts";
import type { RetryPolicy, StepState } from "../../lib/schemas.ts";

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
	execEffect: Effect.Effect<unknown, Error, unknown>,
	retryPolicy: RetryPolicy | undefined,
	stepId: string,
): Effect.Effect<unknown, Error | Cause.TimeoutError, unknown> {
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
	const step = steps[idx];
	if (step === undefined) return undefined;
	return { idx, step };
}

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

/**
 * Live implementation of the `Pipeline` actor.
 *
 * State shape: `{ status, steps, schedule }` (see `PipelineState` in api.ts).
 * The step execution loop runs as a forked fiber so that `Pause`, `Resume`,
 * and `SkipStep` can be dispatched concurrently while steps are executing.
 */
export const PipelineLive = Pipeline.toLayer(
	({ rawRivetkitContext, state }) => {
		// -------------------------------------------------------------------
		// Step execution loop — forked into the actor scope by Start/Resume.
		// -------------------------------------------------------------------

		const runLoop: Effect.Effect<string, never, unknown> = Effect.gen(function* () {
			const initial = yield* State.get(state).pipe(Effect.orDie);
			rawRivetkitContext.broadcast("pipelineStarted", initial);

			// Capture step IDs at launch; the loop re-reads state each
			// iteration so pause/skip/status changes are observed live.
			const stepIds = initial.steps.map((s) => s.definition.id);

			for (const stepId of stepIds) {
				// Check for pause between steps.
				const current = yield* State.get(state).pipe(Effect.orDie);
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

				// Dependency check — every declared dep must be completed or skipped.
				const depsMet = step.definition.dependsOn.every((depId) => {
					const dep = findStep(current.steps, depId);
					return (
						dep !== undefined &&
						(dep.step.status === "completed" ||
							dep.step.status === "skipped")
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
									error: `Unmet dependencies: ${step.definition.dependsOn.join(", ")}`,
									completedAt: Date.now(),
								}
								: st,
						),
					})).pipe(Effect.orDie);
					rawRivetkitContext.broadcast("stepFailed", blocked.steps[idx]);
					continue;
				}

				// Mark step as running.
				const runningState = yield* State.updateAndGet(state, (s) => ({
					...s,
					steps: s.steps.map((st) =>
						st.definition.id === stepId
							? {
								...st,
								status: "running" as const,
								startedAt: Date.now(),
								attempts: st.attempts + 1,
							}
							: st,
					),
				})).pipe(Effect.orDie);
				rawRivetkitContext.broadcast("stepStarted", runningState.steps[idx]);

				// Resolve executor.
				const executor = getStepExecutor(step.definition.type);
				if (executor === undefined) {
					const noExec = yield* State.updateAndGet(state, (s) => ({
						...s,
						steps: s.steps.map((st) =>
							st.definition.id === stepId
								? {
									...st,
									status: "failed" as const,
									error: `No executor registered for step type: ${step.definition.type}`,
									completedAt: Date.now(),
								}
								: st,
						),
					})).pipe(Effect.orDie);
					rawRivetkitContext.broadcast("stepFailed", noExec.steps[idx]);
					continue;
				}

				// Build step context with results from completed steps.
				const previousResults = new Map<string, unknown>();
				for (const s of current.steps) {
					if (s.status === "completed" && s.result !== undefined) {
						previousResults.set(s.definition.id, s.result);
					}
				}
				const ctx: StepContext = {
					projectId: rawRivetkitContext.key[0] ?? rawRivetkitContext.actorId,
					pipelineId: rawRivetkitContext.actorId,
					stepId: step.definition.id,
					config: step.definition.config,
					previousResults,
					rawRivetkitContext,
					emit: (event) => {
						// Broadcast progress event to connected clients.
						// The event includes the stepId so the UI can route it.
						rawRivetkitContext.broadcast("stepProgress", {
							stepId: step.definition.id,
							...event,
							timestamp: Date.now(),
						});
					},
				};

				// Execute with retry + timeout.
				const execEffect = withRetryAndTimeout(
					executor.execute(ctx),
					step.definition.retryPolicy,
					step.definition.id,
				);
				const exit = yield* execEffect.pipe(Effect.exit);

				if (Exit.isSuccess(exit)) {
					const completed = yield* State.updateAndGet(state, (s) => ({
						...s,
						steps: s.steps.map((st) =>
							st.definition.id === stepId
								? {
									...st,
									status: "completed" as const,
									completedAt: Date.now(),
									result: exit.value,
								}
								: st,
						),
					})).pipe(Effect.orDie);
					rawRivetkitContext.broadcast(
						"stepCompleted",
						completed.steps[idx],
					);
				} else {
					const squashed = Cause.squash(exit.cause);
					const errorMsg = squashed instanceof Error
						? squashed.message
						: String(squashed);
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
					})).pipe(Effect.orDie);
					rawRivetkitContext.broadcast("stepFailed", failed.steps[idx]);

					// A failed step halts the pipeline.
					const halted = yield* State.updateAndGet(state, (s) => ({
						...s,
						status: "failed" as const,
					})).pipe(Effect.orDie);
					rawRivetkitContext.broadcast("pipelineCompleted", halted);
					return halted.status;
				}
			}

			// All steps processed — determine final status.
			const finalState = yield* State.get(state).pipe(Effect.orDie);
			const allDone = finalState.steps.every(
				(s) => s.status === "completed" || s.status === "skipped",
			);
			const finalStatus = allDone ? "completed" : "failed";
			const done = yield* State.updateAndGet(state, (s) => ({
				...s,
				status: finalStatus as "completed" | "failed",
			})).pipe(Effect.orDie);
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
					})).pipe(Effect.orDie);
					return updated.steps;
				}),

			RemoveStep: ({ payload }) =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(state, (s) => ({
						...s,
						steps: s.steps.filter(
							(st) => st.definition.id !== payload.stepId,
						),
					})).pipe(Effect.orDie);
					return updated.steps;
				}),

			GetStatus: () =>
				Effect.gen(function* () {
					return yield* State.get(state).pipe(Effect.orDie);
				}),

			// -- Lifecycle -------------------------------------------------------

			Start: () =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(state, (s) => ({
						...s,
						status: "running" as const,
					})).pipe(Effect.orDie);
					// Fork the execution loop so Pause/Skip can be called concurrently.
					yield* runLoop.pipe(Effect.forkDetach);
					return updated.status;
				}),

			Pause: () =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(state, (s) => ({
						...s,
						status: "paused" as const,
					})).pipe(Effect.orDie);
					rawRivetkitContext.broadcast("pipelinePaused", updated);
					return updated.status;
				}),

			Resume: () =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(state, (s) => ({
						...s,
						status: "running" as const,
					})).pipe(Effect.orDie);
					rawRivetkitContext.broadcast("pipelineResumed", updated);
					yield* runLoop.pipe(Effect.forkDetach);
					return updated.status;
				}),

			// -- Per-step operations --------------------------------------------

			RetryStep: ({ payload }) =>
				Effect.gen(function* () {
					const current = yield* State.get(state).pipe(Effect.orDie);
					const found = findStep(current.steps, payload.stepId);
					if (found === undefined) {
						return yield* Effect.die(
							new Error(`Step not found: ${payload.stepId}`),
						);
					}
					const { idx, step } = found;

					// Mark as running.
					const running = yield* State.updateAndGet(state, (s) => ({
						...s,
						steps: s.steps.map((st) =>
							st.definition.id === payload.stepId
								? {
									...st,
									status: "running" as const,
									startedAt: Date.now(),
									attempts: st.attempts + 1,
									error: undefined,
								}
								: st,
						),
					})).pipe(Effect.orDie);
					rawRivetkitContext.broadcast("stepStarted", running.steps[idx]);

					// Build context.
					const previousResults = new Map<string, unknown>();
					for (const s of current.steps) {
						if (s.status === "completed" && s.result !== undefined) {
							previousResults.set(s.definition.id, s.result);
						}
					}
					const ctx: StepContext = {
						projectId: rawRivetkitContext.key[0] ?? rawRivetkitContext.actorId,
						pipelineId: rawRivetkitContext.actorId,
						stepId: step.definition.id,
						config: step.definition.config,
						previousResults,
						rawRivetkitContext,
						emit: (event) => {
							rawRivetkitContext.broadcast("stepProgress", {
								stepId: step.definition.id,
								...event,
								timestamp: Date.now(),
							});
						},
					};

					const executor = getStepExecutor(step.definition.type);
					if (executor === undefined) {
						const failed = yield* State.updateAndGet(state, (s) => ({
							...s,
							steps: s.steps.map((st) =>
								st.definition.id === payload.stepId
									? {
										...st,
										status: "failed" as const,
										error: `No executor registered for step type: ${step.definition.type}`,
										completedAt: Date.now(),
									}
									: st,
							),
						})).pipe(Effect.orDie);
						rawRivetkitContext.broadcast("stepFailed", failed.steps[idx]);
						return failed.steps[idx]!;
					}

					const execEffect = withRetryAndTimeout(
						executor.execute(ctx),
						step.definition.retryPolicy,
						step.definition.id,
					);
					const exit = yield* execEffect.pipe(Effect.exit);

					if (Exit.isSuccess(exit)) {
						const completed = yield* State.updateAndGet(state, (s) => ({
							...s,
							steps: s.steps.map((st) =>
								st.definition.id === payload.stepId
									? {
										...st,
										status: "completed" as const,
										completedAt: Date.now(),
										result: exit.value,
									}
									: st,
							),
						})).pipe(Effect.orDie);
						rawRivetkitContext.broadcast(
							"stepCompleted",
							completed.steps[idx],
						);
						return completed.steps[idx]!;
					}

					const squashed = Cause.squash(exit.cause);
					const errorMsg = squashed instanceof Error
						? squashed.message
						: String(squashed);
					const failed = yield* State.updateAndGet(state, (s) => ({
						...s,
						steps: s.steps.map((st) =>
							st.definition.id === payload.stepId
								? {
									...st,
									status: "failed" as const,
									error: errorMsg,
									completedAt: Date.now(),
								}
								: st,
						),
					})).pipe(Effect.orDie);
					rawRivetkitContext.broadcast("stepFailed", failed.steps[idx]);
					return failed.steps[idx]!;
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
					}).pipe(Effect.orDie);
					const found = findStep(updated.steps, payload.stepId);
					if (found === undefined) {
						return yield* Effect.die(
							new Error(`Step not found: ${payload.stepId}`),
						);
					}
					return found.step;
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
					})).pipe(Effect.orDie);
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
					})).pipe(Effect.orDie);
					return true;
				}),

			_cronTick: () =>
				Effect.gen(function* () {
					const current = yield* State.get(state).pipe(Effect.orDie);
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
					})).pipe(Effect.orDie);
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
				steps: [],
				schedule: undefined,
			}),
		},
	},
);
