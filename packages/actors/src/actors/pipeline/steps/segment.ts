import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";

/**
 * Segment — gathers all chapter transcriptions from the database and
 * joins them into a single text stream for downstream story planning.
 *
 * Chapters are transcribed independently on upload (ChapterActor), so
 * this step reads from the `transcript_chunks` table rather than from
 * a preceding transcribe/normalize step.
 *
 * Depends on: ingest_knowledge (ensures embeddings/wiki are built first)
 * Output: `{ step, status, fullText, chunkCount, chapterCount }`
 * No DB writes — pure text assembly.
 */

export interface SegmentResult {
	step: "segment";
	status: "completed";
	fullText: string;
	chunkCount: number;
	chapterCount: number;
}

export const SegmentStep: StepExecutor = {
	type: "segment",
	inputs: ["ingest_knowledge"],
	outputs: ["segment"],
	execute: (ctx: StepContext): Effect.Effect<StepOutput, Error, unknown> =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Fetch all transcript chunks for this project from DB.
			const chunks = yield* Effect.tryPromise({
				try: () => bridge.repo.transcriptChunks.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			if (chunks.length === 0) {
				return yield* Effect.fail(
					new Error("segment: no transcript chunks found — upload and transcribe chapters first"),
				);
			}

			// Group chunks by chapter, sort by chapter index then chunk index.
			const chapters = yield* Effect.tryPromise({
				try: () => bridge.repo.chapters.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			const chapterOrder = new Map(chapters.map((c) => [c.id, c.index]));

			const sorted = [...chunks].sort((a, b) => {
				const aOrder = chapterOrder.get(a.chapterId ?? "") ?? 0;
				const bOrder = chapterOrder.get(b.chapterId ?? "") ?? 0;
				if (aOrder !== bOrder) return aOrder - bOrder;
				return (a.index ?? 0) - (b.index ?? 0);
			});

			const texts: string[] = [];
			for (const chunk of sorted) {
				if (typeof chunk.text === "string" && chunk.text.length > 0) {
					texts.push(chunk.text);
				}
			}

			const fullText = texts.join("\n\n");
			const chapterCount = new Set(chunks.map((c) => c.chapterId)).size;

			yield* Effect.logInfo(
				`segment: joined ${chunks.length} chunks from ${chapterCount} chapters into ${fullText.length} chars`,
			);

			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "segment" as const,
					status: "completed" as const,
					fullText,
					chunkCount: chunks.length,
					chapterCount,
				} satisfies SegmentResult,
				summary: `${chunks.length} chunks, ${chapterCount} chapters, ${fullText.length} chars`,
			} satisfies StepOutput;
		}),
};

registerStep(SegmentStep);
