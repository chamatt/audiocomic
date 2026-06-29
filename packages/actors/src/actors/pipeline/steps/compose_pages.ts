import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { getPrevResult, isRenderPanelsResult } from "./helpers.ts";
import { uuid, nowIso, pageImageKey } from "@audiocomic/shared";
import type { PageComposite } from "@audiocomic/domain";

// ─── compose_pages step ───
// Composites rendered panel images into full pages, persists PageComposite
// records, and links each page to its composite. Reads panel image keys from
// the render_panels result and page/panel specs from the DB.

export interface ComposePagesResult {
	step: "compose_pages";
	status: "completed";
	pageImageKeys: Map<string, string>;
}

export const ComposePagesStep: StepExecutor = {
	type: "compose_pages",
	inputs: ["render_panels"],
	outputs: ["compose_pages"],
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Read page and panel specs from the DB.
			const pages = yield* Effect.tryPromise({
				try: () => bridge.repo.pageSpecs.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});
			const panels = yield* Effect.tryPromise({
				try: () => bridge.repo.panelSpecs.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			// Read render_panels result for the panelImageKeys map.
			const renderPanels = yield* getPrevResult(ctx, "render_panels", isRenderPanelsResult);
			const panelImageKeys = renderPanels.panelImageKeys;

			const pageImageKeys = new Map<string, string>();

			for (const page of pages) {
				// Filter panels belonging to this page.
				const pagePanels = panels.filter((p) => p.pageId === page.id);

				// Read each rendered panel image from storage, preserving panel order.
				const panelImages: Buffer[] = [];
				for (const panel of pagePanels) {
					const key = panelImageKeys.get(panel.id);
					if (key === undefined) continue; // panel not rendered — skip
					const img = yield* Effect.tryPromise({
						try: () => bridge.storage.readAsset(key),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					});
					panelImages.push(img);
				}

				if (panelImages.length === 0) {
					yield* Effect.logInfo(
						`compose_pages: no rendered panels for page ${page.id} — skipping`,
					);
					continue;
				}

				// Compose the page image from panel images.
				const composed = yield* Effect.tryPromise({
					try: () => bridge.composePage(panelImages, page, pagePanels, { width: 1200, height: 1600 }),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});

				// Write composed image to storage.
				const key = pageImageKey(ctx.projectId, page.id, 0);
				yield* Effect.tryPromise({
					try: () => bridge.storage.writeAsset(key, composed),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});

				// Build + persist the PageComposite record.
				const composite: PageComposite = {
					id: uuid(),
					pageId: page.id,
					projectId: ctx.projectId,
					imageKey: key,
					width: 1200,
					height: 1600,
					panelImageKeys: pagePanels.map((p) => p.id),
					createdAt: nowIso(),
					version: 0,
				};
				yield* Effect.tryPromise({
					try: () => bridge.repo.pageComposites.create(composite),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});

				// Link the page to its composite.
				yield* Effect.tryPromise({
					try: () => bridge.repo.pageSpecs.patch(page.id, { compositeId: composite.id }),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});

				pageImageKeys.set(page.id, key);

				yield* Effect.logInfo(
					`compose_pages: composed page ${page.id} from ${panelImages.length} panels`,
				);
			}

			yield* Effect.logInfo(
				`compose_pages: composed ${pageImageKeys.size} pages`,
			);

			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "compose_pages" as const,
					status: "completed" as const,
					pageImageKeys,
				} satisfies ComposePagesResult,
				summary: `${pageImageKeys.size} pages composed`,
			} satisfies StepOutput;
		}),
};

registerStep(ComposePagesStep);
