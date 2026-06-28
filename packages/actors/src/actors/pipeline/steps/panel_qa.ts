import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const PanelQaStep: StepExecutor = {
	type: "panel_qa",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("panel_qa: running panel QA checks (placeholder)");
			return { step: "panel_qa", status: "completed" as const };
		}),
};

registerStep(PanelQaStep);
