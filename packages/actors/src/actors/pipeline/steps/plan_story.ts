import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const PlanStoryStep: StepExecutor = {
	type: "plan_story",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("plan_story: calling story planner adapter (placeholder)");
			return { step: "plan_story", status: "completed" as const };
		}),
};

registerStep(PlanStoryStep);
