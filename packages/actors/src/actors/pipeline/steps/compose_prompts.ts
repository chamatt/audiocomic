import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const ComposePromptsStep: StepExecutor = {
	type: "compose_prompts",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("compose_prompts: composing render prompts (placeholder)");
			return { step: "compose_prompts", status: "completed" as const };
		}),
};

registerStep(ComposePromptsStep);
