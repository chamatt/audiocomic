import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const ExportMotionStep: StepExecutor = {
	type: "export_motion",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("export_motion: exporting narrated motion comic (placeholder)");
			return { step: "export_motion", status: "completed" as const };
		}),
};

registerStep(ExportMotionStep);
