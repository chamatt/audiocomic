import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";
import { getPrevResult, isNormalizeResult } from "./helpers.ts";
import { uuid } from "@audiocomic/shared";
import type { TranscriptChunk } from "@audiocomic/domain";

/**
 * Transcribe — calls the transcription adapter on the audio file,
 * persists transcript chunks to the DB, and returns them for downstream steps.
 *
 * Depends on: normalize
 * Output: `{ chunks: TranscriptChunk[], durationSec: number }`
 */
export const TranscribeStep: StepExecutor = {
	type: "transcribe",
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;
			const normalizeResult = getPrevResult(ctx, "normalize", isNormalizeResult);

			if (!normalizeResult.audioPath) {
				yield* Effect.logInfo("transcribe: text modality, skipping audio transcription");
				return { step: "transcribe" as const, status: "completed" as const, chunks: [], durationSec: 0 };
			}

			const audioPath = normalizeResult.audioPath;
			yield* Effect.logInfo(`transcribe: transcribing ${audioPath}`);
			const adapter = bridge.getTranscriptionAdapter();
			const result = yield* Effect.tryPromise({
				try: () => adapter.transcribe(audioPath, { projectId: ctx.projectId }),
				catch: (e) => e instanceof Error ? e : new Error(String(e)),
			});

			const chunks: TranscriptChunk[] = result.chunks.map((c, i) => ({
				...c,
				id: uuid(),
				projectId: ctx.projectId,
				index: i,
			}));

			// Persist to DB — non-fatal if projectId isn't a valid DB entity
			// (e.g. during CLI testing with arbitrary pipeline keys).
			yield* Effect.tryPromise({
				try: () => Promise.all(chunks.map((c) => bridge.repo.transcriptChunks.create(c))),
				catch: (e) => {
					const msg = e instanceof Error ? e.message : String(e);
					return new Error(`transcribe: DB persist failed (non-fatal): ${msg}`);
				},
			}).pipe(
				Effect.catch((e: Error) => Effect.logInfo(e.message)),
			);

			yield* Effect.logInfo(`transcribe: ${chunks.length} chunks, duration=${result.durationSec ?? 0}s`);
			return {
				step: "transcribe" as const,
				status: "completed" as const,
				chunks,
				durationSec: result.durationSec ?? 0,
			};
		}),
};

registerStep(TranscribeStep);
