import { Effect } from "effect";
import type { ProgressEvent } from "@audiocomic/ai";
import type { StepState } from "../../../lib/schemas.ts";

/**
 * Structured progress event emitted by a step during execution.
 * Extends the shared `ProgressEvent` from @audiocomic/ai with a timestamp
 * for broadcast to connected clients via the actor's event system.
 *
 * @example
 * ctx.emit({ type: "llm_chunk", label: "pass1", chunkIndex: 42, elapsed: 3.2 });
 * ctx.emit({ type: "progress", label: "render_panels", current: 3, total: 12, detail: "panel abc-123 done" });
 */
export interface StepProgressEvent extends ProgressEvent {
	/** Timestamp (ms epoch). */
	timestamp: number;
}

/** Callback that steps use to emit progress events. */
export type ProgressEmitter = (event: ProgressEvent) => void;

export interface StepContext {
	projectId: string;
	pipelineId: string;
	stepId: string;
	config: Record<string, unknown>;
	/** Hash of upstream step outputs (computed by run loop for stale detection). */
	inputHash: string;
	previousResults: Map<string, unknown>;
	rawRivetkitContext: unknown;
	/**
	 * Emit a progress event that will be broadcast to connected clients.
	 * Steps should call this for any intermediate progress so the UI can
	 * show live updates (n8n-style flow chart with streaming).
	 */
	emit: ProgressEmitter;
	/**
	 * Abort signal — set when the user pauses the pipeline. Steps that
	 * perform long-running operations (LLM calls, image rendering) should
	 * check this between sub-operations and abort gracefully.
	 */
	shouldAbort?: () => boolean;
}

/**
 * Output produced by a step executor. Contains the result data plus
 * metadata for stale detection and UI display.
 */
export interface StepOutput {
	/** Stable hash of all inputs that produced this output. */
	inputHash: string;
	/** The actual result data. */
	data: unknown;
	/** Human-readable summary for UI display (e.g. "3 sections, 5 characters"). */
	summary: string;
}

export interface StepExecutor {
	readonly type: string;
	/** Step IDs this step consumes results from (for DAG dependency tracking). */
	readonly inputs: readonly string[];
	/** Output keys this step produces (for downstream consumption tracking). */
	readonly outputs: readonly string[];
	execute(ctx: StepContext): Effect.Effect<StepOutput, Error, unknown>;
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
