import { Effect } from "effect";
import type { StepState } from "../../../lib/schemas.ts";

/**
 * Structured progress event emitted by a step during execution.
 * These are broadcast to connected clients via the actor's event system
 * so the UI can show live progress (n8n-style flow chart with streaming).
 *
 * @example
 * // A planner pass streaming LLM tokens:
 * ctx.emit({ type: "llm_chunk", label: "pass1", chunkIndex: 42, elapsed: 3.2 });
 * // A render step showing per-panel progress:
 * ctx.emit({ type: "progress", label: "render_panels", current: 3, total: 12, detail: "panel abc-123 done" });
 */
export interface StepProgressEvent {
	/** Event type — controls how the UI renders this. */
	type:
		| "progress"      // generic progress: current/total or label
		| "llm_chunk"     // LLM streaming: a chunk arrived
		| "llm_done"      // LLM call completed
		| "llm_error"     // LLM call failed
		| "info"          // informational message
		| "warning"       // non-fatal warning
		| "substep_start" // a sub-step (e.g. per-panel render) started
		| "substep_done"  // a sub-step completed
		| "substep_error" // a sub-step failed
		| "output"        // partial or final output preview
	;
	/** Human-readable label for this event (e.g. "pass1", "panel 3/12"). */
	label: string;
	/** Optional detail message. */
	detail?: string;
	/** For progress events: current item index (1-based). */
	current?: number;
	/** For progress events: total items. */
	total?: number;
	/** For LLM events: chunk index in the stream. */
	chunkIndex?: number;
	/** Elapsed seconds since the step (or sub-step) started. */
	elapsed?: number;
	/** Optional partial output preview (e.g. partial JSON from LLM). */
	partial?: unknown;
	/** Timestamp (ms epoch). */
	timestamp: number;
}

/** Callback that steps use to emit progress events. */
export type ProgressEmitter = (event: Omit<StepProgressEvent, "timestamp">) => void;

export interface StepContext {
	projectId: string;
	pipelineId: string;
	stepId: string;
	config: Record<string, unknown>;
	previousResults: Map<string, unknown>;
	rawRivetkitContext: unknown;
	/**
	 * Emit a progress event that will be broadcast to connected clients.
	 * Steps should call this for any intermediate progress so the UI can
	 * show live updates (n8n-style flow chart with streaming).
	 */
	emit: ProgressEmitter;
}

export interface StepExecutor {
	readonly type: string;
	execute(ctx: StepContext): Effect.Effect<unknown, Error, unknown>;
}

const stepRegistry = new Map<string, StepExecutor>();

export function registerStep(executor: StepExecutor): void {
	stepRegistry.set(executor.type, executor);
}

export function getStepExecutor(type: string): StepExecutor | undefined {
	return stepRegistry.get(type);
}

export function listStepTypes(): string[] {
	return Array.from(stepRegistry.keys());
}
