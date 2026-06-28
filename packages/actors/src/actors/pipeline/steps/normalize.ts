import { Effect } from "effect";
import { FFmpeg, FFmpegLive } from "../../../lib/services.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";

/** Type guard for normalize config. */
function isNormalizeConfig(v: unknown): v is { inputPath?: string; textContent?: string } {
	return typeof v === "object" && v !== null;
}

/**
 * Normalize — probes the source audio file (or parses text) and resolves
 * the local file path for downstream steps.
 *
 * Input  (config):   `inputPath` (audio) or `textContent` (text)
 * Output:            `{ audioPath?, textContent?, durationSec? }`
 */
export const NormalizeStep: StepExecutor = {
	type: "normalize",
	inputs: [],
	outputs: ["normalize"],
	execute: (ctx: StepContext): Effect.Effect<StepOutput, Error, unknown> =>
		Effect.gen(function* () {
			if (!isNormalizeConfig(ctx.config)) {
			return yield* Effect.fail(new Error("normalize: invalid config"));
			}
			const cfg = ctx.config as { inputPath?: string; textContent?: string };
			const inputPath = typeof cfg.inputPath === "string" ? cfg.inputPath : undefined;
			const textContent = typeof cfg.textContent === "string" ? cfg.textContent : undefined;

			if (inputPath && inputPath.length > 0) {
				yield* Effect.logInfo(`normalize: probing audio ${inputPath}`);
				const ffmpeg = yield* FFmpeg;
				const duration = yield* ffmpeg.getDuration(inputPath);
				yield* Effect.logInfo(`normalize: duration=${duration}s`);
				return {
					inputHash: ctx.inputHash ?? "",
					data: {
						step: "normalize" as const,
						status: "completed" as const,
						audioPath: inputPath,
						durationSec: duration,
					},
					summary: `Audio normalized: ${duration}s`,
				};
			}

			if (textContent && textContent.length > 0) {
				yield* Effect.logInfo(`normalize: text source (${textContent.length} chars)`);
				return {
					inputHash: ctx.inputHash ?? "",
					data: {
						step: "normalize" as const,
						status: "completed" as const,
						textContent,
					},
					summary: `Text source: ${textContent.length} chars`,
				};
			}

		return yield* Effect.fail(new Error("normalize: no inputPath or textContent in config"));
		}).pipe(Effect.provide(FFmpegLive)),
};

registerStep(NormalizeStep);
