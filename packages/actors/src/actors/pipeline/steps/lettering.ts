import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";
import { getPrevResult, isComposePagesResult, isPlanPagesResult } from "./helpers.ts";
import { uuid, nowIso, letteringKey } from "@audiocomic/shared";
import type { PageSpec, PanelSpec, LetteringSpec, LetteringBox } from "@audiocomic/domain";

/**
 * Lettering — extracts dialogue lines from each page's panels, builds a
 * LetteringSpec per page, renders an SVG overlay via the media adapter, writes
 * it to storage, and persists the spec to the DB.
 *
 * Depends on: compose_pages, plan_pages
 * Output: `{ step, status, letteringKeys: Map<pageId, letteringKey> }`
 */
export const LetteringStep: StepExecutor = {
	type: "lettering",
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// We only need plan_pages for pages + panels; compose_pages is a
			// dependency because lettering overlays must be produced after the
			// page images exist, but we don't read its payload directly here.
			getPrevResult(ctx, "compose_pages", isComposePagesResult);
			const plan = getPrevResult(ctx, "plan_pages", isPlanPagesResult);

			const pages = plan.pages as PageSpec[];
			const panels = plan.panels as PanelSpec[];

			yield* Effect.logInfo(
				`lettering: placing overlays for project ${ctx.projectId} (${pages.length} pages)`,
			);

			const letteringKeys = new Map<string, string>();

			for (const page of pages) {
				const pagePanels = panels.filter((p) => p.pageId === page.id);

				// Extract dialogue lines from every panel on this page, laying
				// them out top-to-bottom with a simple vertical stride.
				const allDialogue: LetteringBox[] = pagePanels.flatMap((p) =>
					p.dialogueLines.map((d, i) => ({
						id: uuid(),
						type: d.type,
						text: d.text,
						bbox: { x: 0.05, y: 0.05 + i * 0.1, w: 0.9, h: 0.08 },
						panelId: p.id,
						speaker: d.speaker,
					})),
				);

				if (allDialogue.length === 0) {
					yield* Effect.logInfo(`lettering: page ${page.id} has no dialogue — skipping`);
					continue;
				}

				const spec: LetteringSpec = {
					id: uuid(),
					pageId: page.id,
					projectId: ctx.projectId,
					boxes: allDialogue,
					version: 0,
					createdAt: nowIso(),
				};

				// Render the SVG overlay for this page.
				const svg = yield* Effect.tryPromise(() =>
					bridge.renderLettering(spec as never, 1200, 1600),
				);

				const key = letteringKey(ctx.projectId, page.id, 0);
				yield* Effect.tryPromise(() =>
					bridge.storage.writeAsset(key, Buffer.from(svg)),
				);

				// Persist the lettering spec to the DB.
				yield* Effect.tryPromise(() => bridge.repo.letteringSpecs.create(spec));

				letteringKeys.set(page.id, key);

				yield* Effect.logInfo(
					`lettering: page ${page.id} — ${allDialogue.length} boxes rendered to ${key}`,
				);
			}

			yield* Effect.logInfo(
				`lettering: complete — ${letteringKeys.size} pages with overlays`,
			);

			return {
				step: "lettering" as const,
				status: "completed" as const,
				letteringKeys,
			};
		}),
};

registerStep(LetteringStep);
