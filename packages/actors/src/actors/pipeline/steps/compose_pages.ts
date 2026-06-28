import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";
import { getPrevResult, isPlanPagesResult, isRenderPanelsResult } from "./helpers.ts";
import { uuid, nowIso, pageImageKey } from "@audiocomic/shared";
import type { PageSpec, PanelSpec, PageComposite } from "@audiocomic/domain";

// ─── compose_pages step ───
// Composites rendered panel images into full pages, persists PageComposite
// records, and links each page to its composite. Reads panel image keys from
// the render_panels result and page/panel specs from the plan_pages result.

export interface ComposePagesResult {
	step: "compose_pages";
	status: "completed";
	pageImageKeys: Map<string, string>;
}

/** Type guard: narrows an unknown to a PanelSpec with the fields we need. */
function isPanelSpec(v: unknown): v is PanelSpec {
	return (
		typeof v === "object" &&
		v !== null &&
		"id" in v &&
		typeof (v as Record<string, unknown>).id === "string" &&
		"pageId" in v &&
		typeof (v as Record<string, unknown>).pageId === "string"
	);
}

/** Type guard: narrows an unknown to a PageSpec with the fields we need. */
function isPageSpec(v: unknown): v is PageSpec {
	return (
		typeof v === "object" &&
		v !== null &&
		"id" in v &&
		typeof (v as Record<string, unknown>).id === "string"
	);
}

export const ComposePagesStep: StepExecutor = {
	type: "compose_pages",
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Read plan_pages result for pages and panels.
			const planPages = getPrevResult(ctx, "plan_pages", isPlanPagesResult);
			const rawPages = planPages.pages;
			const rawPanels = planPages.panels;

			// Read render_panels result for the panelImageKeys map.
			const renderPanels = getPrevResult(ctx, "render_panels", isRenderPanelsResult);
			const panelImageKeys = renderPanels.panelImageKeys;

			// Validate page/panel shapes once up front.
			const pages = rawPages.filter(isPageSpec);
			const panels = rawPanels.filter(isPanelSpec);

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
				step: "compose_pages" as const,
				status: "completed" as const,
				pageImageKeys,
			} satisfies ComposePagesResult;
		}),
};

registerStep(ComposePagesStep);
