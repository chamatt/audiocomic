import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";
import { getPrevResult, isNormalizeResult, isTranscribeResult } from "./helpers.ts";
import type { TranscriptChunk } from "@audiocomic/domain";

/**
 * Segment — joins per-chunk transcripts from the transcribe step into a single
 * text stream for downstream story planning. In text modality (transcribe
 * produced no chunks), falls back to the normalized text content.
 *
 * Depends on: transcribe (audio) or normalize (text)
 * Output: `{ step, status, fullText, chunkCount }`
 * No DB writes — pure text assembly.
 */

/** Type guard: a transcribe chunk must carry a string `text` field. */
function isTranscriptChunk(v: unknown): v is TranscriptChunk {
	return typeof v === "object" && v !== null && "text" in v && typeof (v as Record<string, unknown>).text === "string";
}

export const SegmentStep: StepExecutor = {
	type: "segment",
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const transcribeResult = getPrevResult(ctx, "transcribe", isTranscribeResult);
			const chunks = transcribeResult.chunks;
			const chunkCount = chunks.length;

			let fullText: string;

			if (chunkCount > 0) {
				// Audio modality: join per-chunk transcripts into one text stream.
				const texts: string[] = [];
				for (const chunk of chunks) {
					if (!isTranscriptChunk(chunk)) {
						return yield* Effect.fail(
							new Error("segment: transcribe chunk missing string 'text' field"),
						);
					}
					texts.push(chunk.text);
				}
				fullText = texts.join(" ");
			} else {
				// Text modality: transcribe produced no chunks; fall back to the
				// normalized text content from the normalize step.
				const normalizeResult = getPrevResult(ctx, "normalize", isNormalizeResult);
				if (!normalizeResult.textContent) {
					return yield* Effect.fail(
						new Error("segment: no chunks from transcribe and no textContent from normalize"),
					);
				}
				fullText = normalizeResult.textContent;
			}

			yield* Effect.logInfo(
				`segment: joined ${chunkCount} chunks into ${fullText.length} chars of text`,
			);

			return {
				step: "segment" as const,
				status: "completed" as const,
				fullText,
				chunkCount,
			};
		}),
};

registerStep(SegmentStep);
