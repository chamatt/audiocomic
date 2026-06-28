import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const TranscribeStep: StepExecutor = {
	type: "transcribe",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("transcribe: transcribing audio (placeholder)");
			return { step: "transcribe", status: "completed" as const };
		}),
};

registerStep(TranscribeStep);
