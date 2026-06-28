import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const ValidateLayoutStep: StepExecutor = {
	type: "validate_layout",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("validate_layout: validating page layouts (placeholder)");
			return { step: "validate_layout", status: "completed" as const };
		}),
};

registerStep(ValidateLayoutStep);
