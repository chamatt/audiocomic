import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const SegmentStep: StepExecutor = {
	type: "segment",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("segment: segmenting into chapters/scenes/beats (placeholder)");
			return { step: "segment", status: "completed" as const };
		}),
};

registerStep(SegmentStep);
