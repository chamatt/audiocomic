import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const ComposePagesStep: StepExecutor = {
	type: "compose_pages",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("compose_pages: composing page images (placeholder)");
			return { step: "compose_pages", status: "completed" as const };
		}),
};

registerStep(ComposePagesStep);
