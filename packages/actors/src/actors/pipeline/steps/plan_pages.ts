import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const PlanPagesStep: StepExecutor = {
	type: "plan_pages",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("plan_pages: planning pages and panels (placeholder)");
			return { step: "plan_pages", status: "completed" as const };
		}),
};

registerStep(PlanPagesStep);
