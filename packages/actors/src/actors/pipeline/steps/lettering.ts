import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { getPrevResult, isComposePagesResult } from "./helpers.ts";
import { uuid, nowIso, letteringKey } from "@audiocomic/shared";
import type { LetteringSpec, LetteringBox } from "@audiocomic/domain";

/**
 * Lettering — extracts dialogue lines from each page's panels, builds a
 * LetteringSpec per page, renders an SVG overlay via the media adapter, writes
 * it to storage, and persists the spec to the DB.
 *
 * Depends on: compose_pages
 * Output: `{ step, status, letteringKeys: Map<pageId, letteringKey> }`
 */
export const LetteringStep: StepExecutor = {
	type: "lettering",
	inputs: ["compose_pages"],
	outputs: ["lettering"],
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// compose_pages is a dependency because lettering overlays must be
			// produced after the page images exist; we read its result to access
			// the pageImageKeys map.
			getPrevResult(ctx, "compose_pages", isComposePagesResult);

			// Read pages and panels from the DB rather than in-memory step
			// results, so lettering reflects whatever plan_chapters persisted.
			const pages = yield* Effect.tryPromise({
				try: () => bridge.repo.pageSpecs.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});
			const panels = yield* Effect.tryPromise({
				try: () => bridge.repo.panelSpecs.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

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
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "lettering" as const,
					status: "completed" as const,
					letteringKeys,
				},
				summary: `${letteringKeys.size} pages lettered`,
			} satisfies StepOutput;
		}),
};

registerStep(LetteringStep);
