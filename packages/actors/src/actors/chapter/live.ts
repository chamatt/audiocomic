import { State } from "@rivetkit/effect";
import { Effect } from "effect";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Chapter, ChapterState } from "./api.ts";
import type { TranscriptionOptions, TranscriptResult } from "@audiocomic/ai";
import { PipelineBridge } from "../../lib/pipeline-bridge.ts";
import { uuid } from "@audiocomic/shared";

/**
 * Fresh, empty chapter state. The actor is keyed, so the durable `id` is
 * derived from the actor key by the caller; the initial state only needs to
 * be a valid placeholder with no asset linked and no pipeline run started.
 */
function freshState(): ChapterState {
	return {
		id: "",
		projectId: "",
		index: 0,
		title: "",
		description: undefined,
		sourceAssetId: undefined,
		status: "pending",
		durationSec: undefined,
		transcriptionStatus: "pending",
		pipelineId: undefined,
	};
}

/**
 * Live server implementation of the Chapter actor.
 *
 * State is the full {@link ChapterState} projection. Reads use
 * `State.get(state).pipe(Effect.orDie)` to collapse the schema-error channel;
 * mutations use `State.updateAndGet(state, fn).pipe(Effect.orDie)` and
 * broadcast a `chapterUpdated` event carrying the new state so subscribed
 * clients can reconcile.
 *
 * The wake function pulls {@link PipelineBridge} from the Effect context so
 * the transcription flow can reach the repository, blob storage, and the
 * transcription adapter. `StartTranscription` forks a daemon fiber that
 * downloads the linked asset, writes it to a temp file, runs the adapter,
 * persists the resulting chunks, and flips the state to `completed` (or
 * `failed` on error) — the action itself returns immediately with the
 * chapter in the `running` transcription state.
 */
export const ChapterLive = Chapter.toLayer(
	({ rawRivetkitContext, state }) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			const getState = (): Effect.Effect<ChapterState> =>
				State.get(state).pipe(Effect.orDie);

			const update = (
				fn: (current: ChapterState) => ChapterState,
			): Effect.Effect<ChapterState> =>
				State.updateAndGet(state, fn).pipe(
					Effect.orDie,
					Effect.tap((next) =>
						Effect.sync(() =>
							rawRivetkitContext.broadcast("chapterUpdated", next),
						),
					),
				);

			/**
			 * Background transcription fiber. Downloads the linked source asset,
			 * spills it to a temp file (the adapter reads from a path), runs the
			 * transcription adapter, persists each chunk to the repository, then
			 * flips the chapter to `transcribed` / `completed` and broadcasts
			 * `chapterTranscribed`. Any failure marks the chapter `failed` and
			 * broadcasts `chapterTranscriptionFailed`.
			 */
			const runTranscription = (current: ChapterState): Effect.Effect<void, Error> =>
				Effect.gen(function* () {
					const assetId = current.sourceAssetId;
					if (!assetId) {
						yield* Effect.fail(
							new Error("StartTranscription: no sourceAssetId linked"),
						);
					}

					// 1. Resolve the linked SourceAsset row.
					const asset = yield* Effect.tryPromise({
						try: () => bridge.repo.sourceAssets.getById(assetId!),
						catch: (e) =>
							e instanceof Error ? e : new Error(String(e)),
					});
					if (!asset) {
						yield* Effect.fail(
							new Error(
								`StartTranscription: source asset ${assetId} not found`,
							),
						);
					}

					// 2. Download the audio bytes from blob storage.
					const buffer = yield* Effect.tryPromise({
						try: () => bridge.storage.readAsset(asset!.storageKey),
						catch: (e) =>
							e instanceof Error ? e : new Error(String(e)),
					});

					// 3. Spill to a temp file — the transcription adapter reads
					//    from a filesystem path, not a buffer.
					const tmpPath = join(tmpdir(), `chapter-${current.id}-${uuid()}.audio`);
					yield* Effect.tryPromise({
						try: () => fs.writeFile(tmpPath, buffer),
						catch: (e) =>
							e instanceof Error ? e : new Error(String(e)),
					});

					try {
						// 4. Run the transcription adapter.
						const adapter = bridge.getTranscriptionAdapter();
						const result: TranscriptResult = yield* Effect.tryPromise({
							try: () =>
								adapter.transcribe(tmpPath, {
									projectId: current.projectId,
									chapterId: current.id,
								} as unknown as TranscriptionOptions),
							catch: (e) =>
								e instanceof Error ? e : new Error(String(e)),
						});

						// 5. Persist each chunk, stamped with this chapter id.
						yield* Effect.tryPromise({
							try: () =>
								Promise.all(
									result.chunks.map((chunk) =>
										bridge.repo.transcriptChunks.create({
											...chunk,
											id: uuid(),
											projectId: current.projectId,
											chapterId: current.id,
										}),
									),
								),
							catch: (e) =>
								e instanceof Error ? e : new Error(String(e)),
						});

						// 6. Flip to completed and broadcast.
						const done = yield* update((s) => ({
							...s,
							transcriptionStatus: "completed",
							status: "transcribed",
							durationSec: result.durationSec ?? s.durationSec,
						}));
						rawRivetkitContext.broadcast("chapterTranscribed", done);
					} finally {
						// Clean up the temp file regardless of outcome.
						yield* Effect.tryPromise({
							try: () => fs.unlink(tmpPath),
							catch: (e) =>
								e instanceof Error ? e : new Error(String(e)),
						}).pipe(Effect.ignore);
					}
				}).pipe(
					Effect.catchCause((cause) =>
						Effect.gen(function* () {
							const failed = yield* update((s) => ({
								...s,
								transcriptionStatus: "failed",
								status: "failed",
							}));
							rawRivetkitContext.broadcast(
								"chapterTranscriptionFailed",
								{
									chapterId: failed.id,
									error: cause.toString(),
								},
							);
							yield* Effect.logError(
								`chapter ${failed.id} transcription failed: ${cause.toString()}`,
							);
						}),
					),
				);

			return Chapter.of({
				GetState: () => getState(),

				UpdateTitle: ({ payload }) =>
					update((current) => ({
						...current,
						title: payload.title,
					})),

				UpdateDescription: ({ payload }) =>
					update((current) => ({
						...current,
						description: payload.description,
					})),

				LinkAsset: ({ payload }) =>
					update((current) => ({
						...current,
						sourceAssetId: payload.sourceAssetId,
					})),

				SetStatus: ({ payload }) =>
					update((current) => ({
						...current,
						status: payload.status,
					})),

				SetTranscriptionStatus: ({ payload }) =>
					update((current) => ({
						...current,
						transcriptionStatus: payload.status,
					})),

				StartTranscription: () =>
					Effect.gen(function* () {
						const current = yield* getState();
						if (!current.sourceAssetId) {
							yield* Effect.fail(
								new Error(
									"StartTranscription: no sourceAssetId linked",
								),
							);
						}

						// Mark running immediately and broadcast.
						const running = yield* update((s) => ({
							...s,
							transcriptionStatus: "running",
							status: "transcribing",
						}));

						// Fork a daemon fiber so the action returns now while
						// transcription continues in the background.
					yield* runTranscription(running).pipe(Effect.forkDetach);

						return running;
					}),

				GetPipelineStatus: () =>
					Effect.gen(function* () {
						const current = yield* getState();
						return current.pipelineId;
					}),
			});
		}),
	{
		state: {
			schema: ChapterState,
			initialValue: freshState,
		},
	},
);
