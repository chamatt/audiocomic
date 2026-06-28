import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { getPrevResult, isPlanStoryResult, isSegmentResult } from "./helpers.ts";

// ─── build_bibles step ───
// Runs the Mastra bible builder agent over the chapter transcription to
// extract and persist character states, wiki pages, and world updates.
// The story bibles (sections, characters, world bible) are produced and
// persisted during the plan_story step; this step enriches them with
// temporal character states and wiki knowledge using tool-calling.

export interface BuildBiblesResult {
	step: "build_bibles";
	status: "completed";
	sectionCount: number;
	characterCount: number;
	newStates: number;
	newWikiPages: number;
	contradictions: number;
}

export const BuildBiblesStep: StepExecutor = {
	type: "build_bibles",
	inputs: ["plan_story"],
	outputs: ["build_bibles"],
	execute: (ctx: StepContext): Effect.Effect<StepOutput, Error, unknown> =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;
			const plan = getPrevResult(ctx, "plan_story", isPlanStoryResult);

			const sectionCount = plan.sections.length;
			const characterCount = plan.characters.length;

			// Run the bible builder agent to extract temporal states + wiki pages.
			// Uses the transcription text from the segment step.
			let newStates = 0;
			let newWikiPages = 0;
			let contradictions = 0;

			try {
				const segmentResult = getPrevResult(ctx, "segment", isSegmentResult);
				const fullText = segmentResult.fullText;

				const agent = bridge.getBibleBuilderAgent(ctx.projectId);
				const result = yield* Effect.tryPromise({
					try: () => agent.buildBible({
						projectId: ctx.projectId,
						chapterId: typeof ctx.config.chapterId === "string" ? ctx.config.chapterId : ctx.projectId,
						chapterIndex: typeof ctx.config.chapterIndex === "number" ? ctx.config.chapterIndex : 0,
						text: fullText,
					}),
					catch: (e) => e instanceof Error ? e : new Error(String(e)),
				});

				newStates = result.newStates;
				newWikiPages = result.newWikiPages;
				contradictions = result.contradictions;
			} catch {
				// Segment step may not have run yet — skip agent enrichment
			}

			yield* Effect.logInfo(
				`build_bibles: ${sectionCount} sections, ${characterCount} characters, ${newStates} states, ${newWikiPages} wiki pages, ${contradictions} contradictions`,
			);

			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "build_bibles" as const,
					status: "completed" as const,
					sectionCount,
					characterCount,
					newStates,
					newWikiPages,
					contradictions,
				} satisfies BuildBiblesResult,
				summary: `${sectionCount} sections, ${characterCount} characters, ${newStates} states, ${newWikiPages} wiki pages`,
			};
		}),
};

registerStep(BuildBiblesStep);
