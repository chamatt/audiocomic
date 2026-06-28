import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";
import { getPrevResult, isSegmentResult } from "./helpers.ts";
import type { StorySection, CharacterProfile, WorldBible } from "@audiocomic/domain";

/**
 * Plan story — calls the story planner adapter on the full text to produce
 * sections, character profiles, and a world bible, then persists each to the DB.
 *
 * Depends on: segment
 * Output: `{ sections: StorySection[], characters: CharacterProfile[], worldBible: WorldBible }`
 */
export const PlanStoryStep: StepExecutor = {
	type: "plan_story",
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;
			const segmentResult = getPrevResult(ctx, "segment", isSegmentResult);
			const fullText = segmentResult.fullText;

			yield* Effect.logInfo(`plan_story: planning story for project ${ctx.projectId} (${fullText.length} chars)`);

			const planner = bridge.getStoryPlanner();
		const result = yield* Effect.tryPromise({
			try: () => planner.planStory({
				projectId: ctx.projectId,
				text: fullText,
				emit: ctx.emit,
			}),
			catch: (e) => e instanceof Error ? e : new Error(String(e)),
		});

			const sections: StorySection[] = result.sections;
			const characters: CharacterProfile[] = result.characters;
			const worldBible: WorldBible = result.worldBible;

			yield* Effect.tryPromise({
				try: () =>
					Promise.all([
						Promise.all(sections.map((s) => bridge.repo.storySections.create(s))),
						Promise.all(characters.map((c) => bridge.repo.characterProfiles.create(c))),
						bridge.repo.worldBibles.create(worldBible),
					]),
				catch: (e) => {
					const msg = e instanceof Error ? e.message : String(e);
					return new Error(`plan_story: DB persist failed (non-fatal): ${msg}`);
				},
			}).pipe(
				Effect.catch((e: Error) => Effect.logInfo(e.message)),
			);

			yield* Effect.logInfo(
				`plan_story: ${sections.length} sections, ${characters.length} characters, world bible persisted`,
			);

			return {
				step: "plan_story" as const,
				status: "completed" as const,
				sections,
				characters,
				worldBible,
			};
		}),
};

registerStep(PlanStoryStep);
