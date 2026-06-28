import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { uuid, nowIso } from "@audiocomic/shared";
import type { PanelRenderRequest, PanelRenderResult, PanelSpec } from "@audiocomic/domain";

/** Type guard: a render result carrying inline image bytes to persist. */
function hasImageData(v: PanelRenderResult): v is PanelRenderResult & { imageData: Buffer } {
	return "imageData" in v;
}

export const RenderPanelsStep: StepExecutor = {
	type: "render_panels",
	inputs: ["plan_chapters"],
	outputs: ["render_panels"],
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Read ALL panels for this project from DB — not from in-memory
			// step results. This ensures panels already rendered from the
			// canvas (which patched renderResultId in DB) are skipped.
			const allPanels = yield* Effect.tryPromise({
				try: () => bridge.repo.panelSpecs.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			// Only render panels that have a renderPrompt but no renderResultId.
			const panelsToRender = allPanels.filter(
				(p) => p.renderPrompt && !p.renderResultId,
			) as PanelSpec[];

			const panelImageKeys = new Map<string, string>();
			let renderedCount = 0;
			let skippedCount = allPanels.length - panelsToRender.length;

			yield* Effect.logInfo(
				`render_panels: ${panelsToRender.length} to render, ${skippedCount} already rendered (from DB)`,
			);
			ctx.emit({
				type: "info" as const,
				label: "render_panels",
				detail: `${panelsToRender.length} to render, ${skippedCount} skipped`,
			});

			for (let i = 0; i < panelsToRender.length; i++) {
				if (ctx.shouldAbort?.()) {
					yield* Effect.logInfo("render_panels: aborted by user");
					break;
				}

				const panel = panelsToRender[i]!;
				const prompt = panel.renderPrompt!;

				yield* Effect.logInfo(`render_panels: [${i + 1}/${panelsToRender.length}] rendering panel ${panel.id}...`);
				ctx.emit({
					type: "substep_start" as const,
					label: `panel ${i + 1}/${panelsToRender.length}`,
					current: i + 1,
					total: panelsToRender.length,
					detail: panel.id,
				});

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
						try { await bridge.repo.panelRenderRequests.create(renderReq); } catch { /* non-fatal */ }

						const result: PanelRenderResult = await bridge.getRenderer().render(renderReq);

						try { await bridge.repo.panelRenderResults.create(result); } catch { /* non-fatal */ }
						try {
							await bridge.repo.panelSpecs.patch(panel.id, {
								renderResultId: result.id,
								seed: result.seed ?? renderReq.seed,
							});
						} catch { /* non-fatal */ }

						if (hasImageData(result)) {
							await bridge.storage.writeAsset(result.imageKey, Buffer.from(result.imageData));
						}

						return result;
					},
					catch: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
				});

				panelImageKeys.set(panel.id, result.imageKey);
				renderedCount += 1;

				yield* Effect.logInfo(
					`render_panels: [${i + 1}/${panelsToRender.length}] done in ${result.durationMs ?? 0}ms → ${result.imageKey}`,
				);
				ctx.emit({
					type: "substep_done" as const,
					label: `panel ${i + 1}/${panelsToRender.length}`,
					current: i + 1,
					total: panelsToRender.length,
					detail: `${result.durationMs ?? 0}ms → ${result.imageKey}`,
				});

				yield* Effect.sleep(10);
			}

			yield* Effect.logInfo(`render_panels: ${renderedCount} rendered, ${skippedCount} skipped`);
			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "render_panels" as const,
					status: "completed" as const,
					panelImageKeys,
					renderedCount,
					skippedCount,
				},
				summary: `${renderedCount} rendered, ${skippedCount} skipped`,
			} satisfies StepOutput;
		}),
};

registerStep(RenderPanelsStep);
