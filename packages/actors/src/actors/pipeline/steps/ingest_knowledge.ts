import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { createEmbeddingProvider, ingestChapterTranscription, makeWikiIngestor } from "@audiocomic/knowledge";

/**
 * Ingest Knowledge — the "rebuild index" step.
 *
 * For each transcribed chapter in the project, runs:
 *   1. Embedding pipeline: re-chunks transcript, embeds, persists to
 *      `knowledge_embeddings` (pgvector) for RAG retrieval.
 *   2. Wiki ingest: LLM extracts entities, character states, world facts,
 *      upserts `knowledge_pages` with contradiction detection.
 *
 * This merges all chapter knowledge into a unified, cross-referenced
 * wiki and vector index that downstream steps (plan_story, build_bibles)
 * query via the Mastra agent tools.
 *
 * Depends on: nothing (chapters are transcribed independently on upload)
 * Output: `{ step, status, chaptersProcessed, embeddingsCreated, wikiPagesCreated }`
 */

export interface IngestKnowledgeResult {
	step: "ingest_knowledge";
	status: "completed";
	chaptersProcessed: number;
	embeddingsCreated: number;
	wikiPagesCreated: number;
}

export const IngestKnowledgeStep: StepExecutor = {
	type: "ingest_knowledge",
	inputs: [],
	outputs: ["ingest_knowledge"],
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Fetch all chapters for this project from DB.
			const chapters = yield* Effect.tryPromise({
				try: () => bridge.repo.chapters.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			// Only process chapters that have been transcribed.
			const transcribed = chapters.filter(
				(c) => c.transcriptionStatus === "completed" || c.status === "transcribed",
			);

			if (transcribed.length === 0) {
				return {
					inputHash: ctx.inputHash ?? "",
					data: {
						step: "ingest_knowledge" as const,
						status: "completed" as const,
						chaptersProcessed: 0,
						embeddingsCreated: 0,
						wikiPagesCreated: 0,
					} satisfies IngestKnowledgeResult,
					summary: "No transcribed chapters to ingest",
				} satisfies StepOutput;
			}

			ctx.emit({
				type: "progress" as const,
				label: "ingest_knowledge",
				current: 0,
				total: transcribed.length,
				detail: `Processing ${transcribed.length} chapters`,
			});

			const embedder = createEmbeddingProvider(bridge.env);
			const wiki = makeWikiIngestor(bridge.repo, bridge.getStoryPlanner());

			let embeddingsCreated = 0;
			let wikiPagesCreated = 0;
			let processed = 0;

			for (const chapter of transcribed) {
				if (ctx.shouldAbort?.()) {
					yield* Effect.logInfo("ingest_knowledge: aborted by user");
					break;
				}

				ctx.emit({
					type: "progress" as const,
					label: "ingest_knowledge",
					current: processed,
					total: transcribed.length,
					detail: `Ingesting chapter ${chapter.index + 1}: ${chapter.title}`,
				});

				// --- Embedding pipeline ---
				yield* Effect.tryPromise({
					try: () =>
						ingestChapterTranscription(bridge.repo, embedder, ctx.projectId, chapter.id),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}).pipe(
					Effect.tap(() => Effect.sync(() => { embeddingsCreated++; })),
					Effect.catchCause((cause) =>
						Effect.logError(
							`ingest_knowledge: embedding failed for chapter ${chapter.id}: ${cause.toString()}`,
						),
					),
				);

				// --- Wiki ingest pipeline ---
				const chapterChunks = yield* Effect.tryPromise({
					try: () => bridge.repo.transcriptChunks.getByProjectId(ctx.projectId),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				const chapterText = chapterChunks
					.filter((c) => c.chapterId === chapter.id)
					.map((c) => c.text)
					.join("\n");

				const beforePages = yield* Effect.tryPromise({
					try: () => bridge.repo.knowledgePages.getByProjectId(ctx.projectId),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				const beforeCount = beforePages.length;

				yield* Effect.tryPromise({
					try: () =>
						wiki.ingestChapter(chapter.id, ctx.projectId, chapterText, chapter.index),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}).pipe(
					Effect.catchCause((cause) =>
						Effect.logError(
							`ingest_knowledge: wiki ingest failed for chapter ${chapter.id}: ${cause.toString()}`,
						),
					),
				);

				const afterPages = yield* Effect.tryPromise({
					try: () => bridge.repo.knowledgePages.getByProjectId(ctx.projectId),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				wikiPagesCreated += Math.max(0, afterPages.length - beforeCount);
				processed++;
			}

			ctx.emit({
				type: "progress" as const,
				label: "ingest_knowledge",
				current: processed,
				total: transcribed.length,
				detail: `Done: ${processed} chapters, ${embeddingsCreated} embeddings, ${wikiPagesCreated} wiki pages`,
			});

			yield* Effect.logInfo(
				`ingest_knowledge: processed ${processed} chapters, ${embeddingsCreated} embeddings, ${wikiPagesCreated} wiki pages`,
			);

			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "ingest_knowledge" as const,
					status: "completed" as const,
					chaptersProcessed: processed,
					embeddingsCreated,
					wikiPagesCreated,
				} satisfies IngestKnowledgeResult,
				summary: `${processed} chapters ingested, ${embeddingsCreated} embeddings, ${wikiPagesCreated} wiki pages`,
			} satisfies StepOutput;
		}),
};

registerStep(IngestKnowledgeStep);
