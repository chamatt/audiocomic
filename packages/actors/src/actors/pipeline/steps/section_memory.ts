import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const SectionMemoryStep: StepExecutor = {
	type: "section_memory",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("section_memory: building section memory embeddings (placeholder)");
			return { step: "section_memory", status: "completed" as const };
		}),
};

registerStep(SectionMemoryStep);
