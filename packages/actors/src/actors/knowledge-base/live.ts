import { State, Actor } from "@rivetkit/effect";
import { Effect } from "effect";

import {
	KnowledgeBase,
	KnowledgeBaseStatus,
} from "./api.ts";
import { PipelineBridge } from "../../lib/pipeline-bridge.ts";
import { createDb } from "@audiocomic/db";
import {
	createEmbeddingProvider,
	ingestChapterTranscription,
	searchKnowledgeBase,
	makeWikiIngestor,
} from "@audiocomic/knowledge";

/**
 * Fresh, empty knowledge base status. The actor is keyed by project id,
 * so `projectId` is overlaid from the actor key on every read — the
 * stored placeholder stays empty until the first action lands.
 */
function freshState(): KnowledgeBaseStatus {
	return {
		projectId: "",
		embeddingStatus: {},
		wikiStatus: {},
		lastLintAt: undefined,
		contradictionCount: 0,
	};
}

/** Default number of vector-search hits when `Query` omits `topK`. */
const DEFAULT_TOP_K = 5;

/**
 * Live server implementation of the KnowledgeBase actor.
 *
 * State is the {@link KnowledgeBaseStatus} projection. Reads use
 * `State.get(state).pipe(Effect.orDie)`; mutations use
 * `State.updateAndGet(state, fn).pipe(Effect.orDie)` and broadcast a
 * `knowledgeBaseUpdated` event carrying the new status so subscribed
 * clients can reconcile. The stored `projectId` placeholder is overlaid
 * with the real actor key on every read/write so callers always see the
 * project the actor was keyed by.
 *
 * The wake function pulls {@link PipelineBridge} from the Effect context
 * and the actor's address from {@link Actor.CurrentAddress} (captured
 * once into the `projectId` closure). A raw Drizzle `db` is created from
 * `DATABASE_URL` for `searchKnowledgeBase`, which needs raw SQL access
 * to the `knowledge_embeddings` table that the Repository does not
 * expose.
 *
 * `IngestChapter` forks a daemon fiber that runs the embedding pipeline
 * (`ingestChapterTranscription`) and the wiki extraction pipeline
 * (`makeWikiIngestor.ingestChapter`) for the chapter, flipping each
 * per-chapter status to `completed` (or `failed` on error) and
 * broadcasting `knowledgeBaseUpdated` — the action itself returns
 * immediately with the chapter marked `running`.
 */
export const KnowledgeBaseLive = KnowledgeBase.toLayer(
	({ rawRivetkitContext, state }) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;
			const address = yield* Actor.CurrentAddress;
			// The actor is keyed by project id; the key is a string tuple.
			const projectId: string = address.key[0] ?? "";

			// Raw Drizzle instance for vector search. The Repository does not
			// expose the raw SQL needed by `searchKnowledgeBase`, so the actor
			// holds its own connection for the lifetime of the instance.
			const db = createDb(bridge.env.DATABASE_URL).db;

			const getState = (): Effect.Effect<KnowledgeBaseStatus> =>
				State.get(state).pipe(
					Effect.orDie,
					Effect.map((s) => ({ ...s, projectId })),
				);

			const update = (
				fn: (current: KnowledgeBaseStatus) => KnowledgeBaseStatus,
			): Effect.Effect<KnowledgeBaseStatus> =>
				State.updateAndGet(state, fn).pipe(
					Effect.orDie,
					Effect.map((next) => ({ ...next, projectId })),
					Effect.tap((next) =>
						Effect.sync(() =>
							rawRivetkitContext.broadcast("knowledgeBaseUpdated", next),
						),
					),
				);

			/**
			 * Gather the concatenated transcript text and the chapter index
			 * for one chapter, then run the wiki ingestor over it.
			 */
			const runWikiIngest = async (chapterId: string): Promise<void> => {
				const chapter = await bridge.repo.chapters.getById(chapterId);
				const chapterIndex = chapter?.index ?? 0;

				const chunks = await bridge.repo.transcriptChunks.getByProjectId(projectId);
				const chapterText = chunks
					.filter((c) => c.chapterId === chapterId)
					.map((c) => c.text)
					.join("\n");

				const wiki = makeWikiIngestor(bridge.repo, bridge.getStoryPlanner());
				await wiki.ingestChapter(chapterId, projectId, chapterText, chapterIndex);
			};

			/**
			 * Background ingestion fiber. Runs the embedding pipeline and the
			 * wiki extraction pipeline for one chapter, updating each
			 * per-chapter status independently. A failure on one path marks
			 * only that path `failed`; both paths broadcast the final status
			 * via the `update` helper.
			 */
			const runIngest = (chapterId: string): Effect.Effect<void, Error> =>
				Effect.gen(function* () {
					const embedder = createEmbeddingProvider(bridge.env);

					// --- Embedding pipeline ---
					yield* Effect.tryPromise({
						try: () =>
							ingestChapterTranscription(bridge.repo, embedder, projectId, chapterId),
						catch: (e) =>
							e instanceof Error ? e : new Error(String(e)),
					}).pipe(
						Effect.flatMap(() =>
							update((s) => ({
								...s,
								embeddingStatus: {
									...s.embeddingStatus,
									[chapterId]: "completed",
								},
							})),
						),
						Effect.catchCause((cause) =>
							Effect.gen(function* () {
								yield* update((s) => ({
									...s,
									embeddingStatus: {
										...s.embeddingStatus,
										[chapterId]: "failed",
									},
								}));
								yield* Effect.logError(
									`knowledge base embedding failed for chapter ${chapterId}: ${cause.toString()}`,
								);
							}),
						),
					);

					// --- Wiki ingest pipeline ---
					yield* Effect.tryPromise({
						try: () => runWikiIngest(chapterId),
						catch: (e) =>
							e instanceof Error ? e : new Error(String(e)),
					}).pipe(
						Effect.flatMap(() =>
							update((s) => ({
								...s,
								wikiStatus: {
									...s.wikiStatus,
									[chapterId]: "completed",
								},
							})),
						),
						Effect.catchCause((cause) =>
							Effect.gen(function* () {
								yield* update((s) => ({
									...s,
									wikiStatus: {
										...s.wikiStatus,
										[chapterId]: "failed",
									},
								}));
								yield* Effect.logError(
									`knowledge base wiki ingest failed for chapter ${chapterId}: ${cause.toString()}`,
								);
							}),
						),
					);
				});

			return KnowledgeBase.of({
				GetStatus: () => getState(),

				IngestChapter: ({ payload }) =>
					Effect.gen(function* () {
						// Mark both paths running immediately and broadcast.
						const running = yield* update((s) => ({
							...s,
							embeddingStatus: {
								...s.embeddingStatus,
								[payload.chapterId]: "running",
							},
							wikiStatus: {
								...s.wikiStatus,
								[payload.chapterId]: "running",
							},
						}));

						// Fork a daemon fiber so the action returns now while
						// ingestion continues in the background.
						yield* runIngest(payload.chapterId).pipe(Effect.forkDetach);

						return running;
					}),

				Query: ({ payload }) =>
					Effect.gen(function* () {
						const embedder = createEmbeddingProvider(bridge.env);
						const results = yield* Effect.tryPromise({
							try: () =>
								searchKnowledgeBase(
									db,
									embedder,
									projectId,
									payload.query,
									payload.topK ?? DEFAULT_TOP_K,
								),
							catch: (e) =>
								e instanceof Error ? e : new Error(String(e)),
						});
						return results;
					}),

				GetWiki: () =>
					Effect.gen(function* () {
						const pages = yield* Effect.tryPromise({
							try: () => bridge.repo.knowledgePages.getByProjectId(projectId),
							catch: (e) =>
								e instanceof Error ? e : new Error(String(e)),
						});
						return pages.map((p) => ({
							id: p.id,
							type: p.type,
							title: p.title,
							content: p.content,
							confidence: p.confidence,
						}));
					}),

				Lint: () =>
					Effect.gen(function* () {
						const wiki = makeWikiIngestor(bridge.repo, bridge.getStoryPlanner());
						const report = yield* Effect.tryPromise({
							try: () => wiki.lint(projectId),
							catch: (e) =>
								e instanceof Error ? e : new Error(String(e)),
						});
						yield* update((s) => ({
							...s,
							lastLintAt: Date.now(),
							contradictionCount: report.contradictions.length,
						}));
						return report;
					}),

				GetCharacterTimeline: ({ payload }) =>
					Effect.gen(function* () {
						const states = yield* Effect.tryPromise({
							try: () => bridge.repo.characterStates.getByProjectId(projectId),
							catch: (e) =>
								e instanceof Error ? e : new Error(String(e)),
						});
						return states
							.filter((s) => s.characterId === payload.characterId)
							.sort((a, b) => a.chapterIndex - b.chapterIndex)
							.map((s) => ({
								chapterId: s.chapterId,
								chapterIndex: s.chapterIndex,
								outfit: s.outfit,
								location: s.location,
								mood: s.mood,
								notes: s.notes,
							}));
					}),
			});
		}),
	{
		state: {
			schema: KnowledgeBaseStatus,
			initialValue: freshState,
		},
	},
);
