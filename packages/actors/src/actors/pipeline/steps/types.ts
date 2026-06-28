import { Effect } from "effect";
import type { StepState } from "../../../lib/schemas.ts";

export interface StepContext {
	projectId: string;
	pipelineId: string;
	stepId: string;
	config: Record<string, unknown>;
	previousResults: Map<string, unknown>;
	rawRivetkitContext: any;
}

export interface StepExecutor {
	readonly type: string;
	execute(ctx: StepContext): Effect.Effect<unknown, Error>;
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
