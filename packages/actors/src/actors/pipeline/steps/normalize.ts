import { Effect } from "effect";
import { FFmpeg, FFmpegLive } from "../../../lib/services.ts";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const NormalizeStep: StepExecutor = {
	type: "normalize",
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const inputPath = ctx.config.inputPath;
			if (typeof inputPath === "string" && inputPath.length > 0) {
				yield* Effect.logInfo(`normalize: probing audio duration for ${inputPath}`);
				const ffmpeg = yield* FFmpeg;
				const duration = yield* ffmpeg.getDuration(inputPath);
				yield* Effect.logInfo(`normalize: duration=${duration}s`);
				return { step: "normalize", status: "completed" as const, duration };
			}
			// Text book path — no audio probing required
			yield* Effect.logInfo("normalize: parsing text book (no audio probe)");
			return { step: "normalize", status: "completed" as const };
		}).pipe(Effect.provide(FFmpegLive)),
};

registerStep(NormalizeStep);
