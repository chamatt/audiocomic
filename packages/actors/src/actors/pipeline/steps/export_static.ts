import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const ExportStaticStep: StepExecutor = {
	type: "export_static",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("export_static: exporting static comic pages (placeholder)");
			return { step: "export_static", status: "completed" as const };
		}),
};

registerStep(ExportStaticStep);
