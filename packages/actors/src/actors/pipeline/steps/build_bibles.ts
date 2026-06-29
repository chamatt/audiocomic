import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";

/**
 * Build Bibles — enriches the knowledge base with temporal character
 * states and wiki pages using the Mastra bible builder agent.
 *
 * Runs per-chapter over all transcribed chapters, reading transcript
 * text from the DB (not from a segment step result).
 *
 * Depends on: ingest_knowledge (ensures embeddings + wiki exist first)
 * Output: `{ chaptersProcessed, newStates, newWikiPages, contradictions }`
 */

export interface BuildBiblesResult {
	step: "build_bibles";
	status: "completed";
	chaptersProcessed: number;
	newStates: number;
	newWikiPages: number;
	contradictions: number;
}

export const BuildBiblesStep: StepExecutor = {
	type: "build_bibles",
	inputs: ["ingest_knowledge"],
	outputs: ["build_bibles"],
	execute: (ctx: StepContext): Effect.Effect<StepOutput, Error, unknown> =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Fetch all transcribed chapters.
			const chapters = yield* Effect.tryPromise({
				try: () => bridge.repo.chapters.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			const transcribed = chapters.filter(
				(c) => c.transcriptionStatus === "completed" || c.status === "transcribed",
			);

			let newStates = 0;
			let newWikiPages = 0;
			let contradictions = 0;

			ctx.emit({
				type: "progress" as const,
				label: "build_bibles",
				current: 0,
				total: transcribed.length,
				detail: `Building bibles for ${transcribed.length} chapters`,
			});

			for (let i = 0; i < transcribed.length; i++) {
				if (ctx.shouldAbort?.()) break;

				const chapter = transcribed[i]!;

				// Get this chapter's transcript text from DB.
				const allChunks = yield* Effect.tryPromise({
					try: () => bridge.repo.transcriptChunks.getByProjectId(ctx.projectId),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				const chapterText = allChunks
					.filter((c) => c.chapterId === chapter.id)
					.map((c) => c.text)
					.join("\n\n");

				if (chapterText.length === 0) continue;

				ctx.emit({
					type: "progress" as const,
					label: "build_bibles",
					current: i,
					total: transcribed.length,
					detail: `Building bible for chapter ${chapter.index + 1}: ${chapter.title}`,
				});

				const agent = yield* Effect.promise(() => bridge.getBibleBuilderAgent(ctx.projectId));
				const result = yield* Effect.tryPromise({
					try: () =>
						agent.buildBible({
							projectId: ctx.projectId,
							chapterId: chapter.id,
							chapterIndex: chapter.index,
							text: chapterText,
						}),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}).pipe(
					Effect.catchCause((cause) =>
						Effect.gen(function* () {
							yield* Effect.logError(
								`build_bibles: agent failed for chapter ${chapter.id}: ${cause.toString()}`,
							);
							return null;
						}),
					),
				);

				if (result !== null) {
					newStates += result.newStates;
					newWikiPages += result.newWikiPages;
					contradictions += result.contradictions;
				}
			}

			yield* Effect.logInfo(
				`build_bibles: ${transcribed.length} chapters, ${newStates} states, ${newWikiPages} wiki pages, ${contradictions} contradictions`,
			);

			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "build_bibles" as const,
					status: "completed" as const,
					chaptersProcessed: transcribed.length,
					newStates,
					newWikiPages,
					contradictions,
				} satisfies BuildBiblesResult,
				summary: `${transcribed.length} chapters, ${newStates} states, ${newWikiPages} wiki pages`,
			} satisfies StepOutput;
		}),
};

registerStep(BuildBiblesStep);
