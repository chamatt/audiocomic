import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { getPrevResult, isPlanStoryResult } from "./helpers.ts";

// ─── section_memory step ───
// For MVP, skip actual embedding generation. Section memory is initialized
// with plain text matching against the sections produced by plan_story;
// vector embeddings are a future enhancement. No DB writes occur here —
// the sections were already persisted by plan_story.

export const SectionMemoryStep: StepExecutor = {
	type: "section_memory",
	inputs: ["plan_story"] as const,
	outputs: ["section_memory"] as const,
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			// Verify the plan_story result is present and well-shaped; extract sections.
			const planStory = yield* Effect.sync(() =>
				getPrevResult(ctx, "plan_story", isPlanStoryResult),
			);
			const sectionCount = planStory.sections.length;

			yield* Effect.logInfo(
				`section_memory: initialized section memory for ${sectionCount} section(s) — using text matching for MVP (embeddings deferred)`,
			);

			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "section_memory" as const,
					status: "completed" as const,
					sectionCount,
				},
				summary: `${sectionCount} sections processed`,
			} satisfies StepOutput;
		}),
};

registerStep(SectionMemoryStep);
