import { Effect } from "effect";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";

export const RenderPanelsStep: StepExecutor = {
	type: "render_panels",
	execute: (_ctx: StepContext) =>
		Effect.gen(function* () {
			yield* Effect.logInfo("render_panels: rendering panel images (placeholder)");
			return { step: "render_panels", status: "completed" as const };
		}),
};

registerStep(RenderPanelsStep);
