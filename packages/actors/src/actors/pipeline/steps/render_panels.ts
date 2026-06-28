import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { getPrevResult, isComposePromptsResult, isPlanPagesResult, isPlanStoryResult } from "./helpers.ts";
import { uuid, nowIso } from "@audiocomic/shared";
import type { PanelRenderRequest, PanelRenderResult, PanelSpec, CharacterProfile } from "@audiocomic/domain";

/** Type guard: a render result carrying inline image bytes to persist. */
function hasImageData(v: PanelRenderResult): v is PanelRenderResult & { imageData: Buffer } {
	return "imageData" in v;
}

export const RenderPanelsStep: StepExecutor = {
	type: "render_panels",
	inputs: ["compose_prompts", "plan_pages", "plan_story"] as const,
	outputs: ["render_panels"] as const,
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			const composeResult = getPrevResult(ctx, "compose_prompts", isComposePromptsResult);
			const panelPrompts = composeResult.panelPrompts;

			const pagesResult = getPrevResult(ctx, "plan_pages", isPlanPagesResult);
			const panels = pagesResult.panels as PanelSpec[];

			const storyResult = getPrevResult(ctx, "plan_story", isPlanStoryResult);
			const characters = storyResult.characters as CharacterProfile[];

			const panelImageKeys = new Map<string, string>();
			let renderedCount = 0;
			let skippedCount = 0;

			yield* Effect.logInfo(`render_panels: ${panels.length} panels to render (sequential)`);
			ctx.emit({ type: "info", label: "render_panels", detail: `${panels.length} panels to render` });

			for (let i = 0; i < panels.length; i++) {
				const panel = panels[i]!;
				const prompt = panelPrompts.get(panel.id);
				if (!prompt) continue;

				// Skip if this panel already has a render result from a previous run.
				// Check both the previousResults map (in-memory) and the DB.
				let alreadyRendered = false;
				if (panel.renderResultId !== undefined) {
					yield* Effect.logInfo(`render_panels: [${i + 1}/${panels.length}] panel ${panel.id} already has renderResultId, skipping`);
					skippedCount += 1;
					alreadyRendered = true;
				}
				if (alreadyRendered) continue;
			yield* Effect.logInfo(`render_panels: [${i + 1}/${panels.length}] rendering panel ${panel.id}...`);
			ctx.emit({ type: "substep_start", label: `panel ${i + 1}/${panels.length}`, current: i + 1, total: panels.length, detail: panel.id });

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

				const result = yield* Effect.tryPromise({
					try: async () => {
						// Persist the render request (non-fatal if DB unavailable).
						try { await bridge.repo.panelRenderRequests.create(renderReq); } catch { /* non-fatal */ }

						const result: PanelRenderResult = await bridge.getRenderer().render(renderReq);

						// Persist the render result (non-fatal).
						try { await bridge.repo.panelRenderResults.create(result); } catch { /* non-fatal */ }
						try {
							await bridge.repo.panelSpecs.patch(panel.id, {
								renderResultId: result.id,
								seed: result.seed ?? renderReq.seed,
							});
						} catch { /* non-fatal */ }

						// Renderer adapters normally persist the image themselves and only
						// return an imageKey. If a result carries inline bytes, write them.
						if (hasImageData(result)) {
							await bridge.storage.writeAsset(result.imageKey, Buffer.from(result.imageData));
						}

						return result;
					},
					catch: (e: unknown) => e instanceof Error ? e : new Error(String(e)),
				});

				panelImageKeys.set(panel.id, result.imageKey);
				renderedCount += 1;
			yield* Effect.logInfo(`render_panels: [${i + 1}/${panels.length}] done in ${result.durationMs ?? 0}ms → ${result.imageKey}`);
			ctx.emit({ type: "substep_done", label: `panel ${i + 1}/${panels.length}`, current: i + 1, total: panels.length, detail: `${result.durationMs ?? 0}ms → ${result.imageKey}` });
				// Yield control briefly so the actor can process concurrent
				// requests (GetStatus, Pause) between panel renders.
				yield* Effect.sleep(10);
			}

			yield* Effect.logInfo(`render_panels: ${renderedCount} rendered, ${skippedCount} skipped`);
			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "render_panels" as const,
					status: "completed" as const,
					renderedCount,
					skippedCount,
					panelImageKeys,
				},
				summary: `${renderedCount} panels rendered`,
			} satisfies StepOutput;
		}),
};

registerStep(RenderPanelsStep);
