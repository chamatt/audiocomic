import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";
import { getPrevResult, isComposePromptsResult, isPlanPagesResult, isPlanStoryResult } from "./helpers.ts";
import { uuid, nowIso } from "@audiocomic/shared";
import type { PanelRenderRequest, PanelRenderResult, PanelSpec, CharacterProfile } from "@audiocomic/domain";

/** Type guard: a render result carrying inline image bytes to persist. */
function hasImageData(v: PanelRenderResult): v is PanelRenderResult & { imageData: Buffer } {
	return "imageData" in v;
}

export const RenderPanelsStep: StepExecutor = {
	type: "render_panels",
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;
			yield* Effect.logInfo("render_panels: rendering panel images");

			const composeResult = getPrevResult(ctx, "compose_prompts", isComposePromptsResult);
			const panelPrompts = composeResult.panelPrompts;

			const pagesResult = getPrevResult(ctx, "plan_pages", isPlanPagesResult);
			const panels = pagesResult.panels as PanelSpec[];

			const storyResult = getPrevResult(ctx, "plan_story", isPlanStoryResult);
			const characters = storyResult.characters as CharacterProfile[];

			const panelImageKeys = new Map<string, string>();
			let renderedCount = 0;

			for (const panel of panels) {
				const prompt = panelPrompts.get(panel.id);
				if (!prompt) continue;

				const renderReq: PanelRenderRequest = {
					id: uuid(),
					panelId: panel.id,
					projectId: ctx.projectId,
					prompt,
					negativePrompt: undefined,
					seed: Math.floor(Math.random() * 1_000_000_000),
					width: 768,
					height: 1024,
					version: 0,
					createdAt: nowIso(),
					referenceImageKeys: [],
				};

				yield* Effect.tryPromise({
					try: async () => {
						await bridge.repo.panelRenderRequests.create(renderReq);
						const result: PanelRenderResult = await bridge.getRenderer().render(renderReq);
						await bridge.repo.panelRenderResults.create(result);
						await bridge.repo.panelSpecs.patch(panel.id, {
							renderResultId: result.id,
							seed: result.seed ?? renderReq.seed,
						});

						// Renderer adapters normally persist the image themselves and only
						// return an imageKey. If a result carries inline bytes, write them.
						if (hasImageData(result)) {
							await bridge.storage.writeAsset(result.imageKey, Buffer.from(result.imageData));
						}

						panelImageKeys.set(panel.id, result.imageKey);
						renderedCount += 1;
					},
					catch: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
				});
			}

			yield* Effect.logInfo(`render_panels: rendered ${renderedCount} panels`);
			return {
				step: "render_panels" as const,
				status: "completed" as const,
				renderedCount,
				panelImageKeys,
			};
		}),
};

registerStep(RenderPanelsStep);
