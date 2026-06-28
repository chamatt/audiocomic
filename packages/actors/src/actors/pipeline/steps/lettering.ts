import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const LetteringStep: StepExecutor = {
	type: "lettering",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("lettering: placing lettering overlays (placeholder)");
			return { step: "lettering", status: "completed" as const };
		}),
};

registerStep(LetteringStep);
