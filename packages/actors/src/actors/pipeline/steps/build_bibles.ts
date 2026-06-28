import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { getPrevResult, isPlanStoryResult } from "./helpers.ts";

// ─── build_bibles step ───
// The story bibles (sections, characters, world bible) are produced and persisted
// during the plan_story step. This step is a marker that confirms the bibles are
// in place and records their counts for downstream consumers. No DB writes here.

export interface BuildBiblesResult {
	step: "build_bibles";
	status: "completed";
	sectionCount: number;
	characterCount: number;
}

export const BuildBiblesStep: StepExecutor = {
	type: "build_bibles",
	inputs: ["plan_story"],
	outputs: ["build_bibles"],
	execute: (ctx: StepContext): Effect.Effect<StepOutput, Error, unknown> =>
		Effect.gen(function* () {
			// Verify the plan_story result carries the bibles we expect.
			const plan = getPrevResult(ctx, "plan_story", isPlanStoryResult);

			const sectionCount = plan.sections.length;
			const characterCount = plan.characters.length;

			yield* Effect.logInfo(
				`build_bibles: bibles built (world bible persisted in plan_story) — ${sectionCount} sections, ${characterCount} characters`,
			);

			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "build_bibles" as const,
					status: "completed" as const,
					sectionCount,
					characterCount,
				} satisfies BuildBiblesResult,
				summary: `${sectionCount} sections, ${characterCount} characters`,
			};
		}),
};

registerStep(BuildBiblesStep);
