import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const BuildBiblesStep: StepExecutor = {
	type: "build_bibles",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("build_bibles: building world/character bibles (placeholder)");
			return { step: "build_bibles", status: "completed" as const };
		}),
};

registerStep(BuildBiblesStep);
