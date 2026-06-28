import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";
import { getPrevResult, isPlanStoryResult } from "./helpers.ts";
import { uuid } from "@audiocomic/shared";
import type { StorySection, PageSpec, PanelSpec } from "@audiocomic/domain";

// ─── plan_pages step ───
// Groups story beats into pages (up to 4 pages × 3 panels) and emits a
// PageSpec + PanelSpecs per group. Layout is a simple vertical stack; the
// validate_layout step checks it afterwards.
//
// Depends on: plan_story
// Output: `{ pages: PageSpec[], panels: PanelSpec[] }`

export interface PlanPagesResult {
	step: "plan_pages";
	status: "completed";
	pages: PageSpec[];
	panels: PanelSpec[];
}

const DEFAULT_MAX_PAGES = 4;
const DEFAULT_BEATS_PER_PAGE = 3;

// plan_story exposes sections as unknown[]; narrow each element safely.
// A beat section must carry a string id/summary and a charactersPresent array.
const isBeatSection = (v: unknown): v is StorySection => {
	if (typeof v !== "object" || v === null) return false;
	const r = v as Record<string, unknown>;
	return (
		r.level === "beat" &&
		typeof r.id === "string" &&
		typeof r.summary === "string" &&
		Array.isArray(r.charactersPresent)
	);
};

/** Evenly sample `max` items from a list, preserving order. */
function sampleEvenly<T>(items: T[], max: number): T[] {
	if (items.length <= max) return items;
	const out: T[] = [];
	const step = items.length / max;
	for (let i = 0; i < max; i++) {
		out.push(items[Math.floor(i * step)]!);
	}
	return out;
}

export const PlanPagesStep: StepExecutor = {
	type: "plan_pages",
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Read the plan_story result to get the section list, then keep beats.
			// Read config overrides for panel count limits.
			const cfg = ctx.config as Record<string, unknown>;
			const maxPages = typeof cfg.maxPages === "number" ? cfg.maxPages : DEFAULT_MAX_PAGES;
			const beatsPerPage = typeof cfg.beatsPerPage === "number" ? cfg.beatsPerPage : DEFAULT_BEATS_PER_PAGE;
			const maxBeats = maxPages * beatsPerPage;

			// Read the plan_story result to get the section list, then keep beats.
			const plan = getPrevResult(ctx, "plan_story", isPlanStoryResult);
			const beats = plan.sections.filter(isBeatSection);

			if (beats.length === 0) {
				return yield* Effect.fail(
					new Error("plan_pages: no beat-level sections from plan_story"),
				);
			}

			// Cap to maxBeats, sampling evenly if there are too many beats.
			const selected = sampleEvenly(beats, maxBeats);
			const pages: PageSpec[] = [];
			const panels: PanelSpec[] = [];

			for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
				const pageBeats = selected.slice(
					pageIdx * beatsPerPage,
					(pageIdx + 1) * beatsPerPage,
				);
				if (pageBeats.length === 0) break;

				const pageId = uuid();
				const panelHeight = 1 / pageBeats.length;
				const panelIds: string[] = [];

				for (let panelIdx = 0; panelIdx < pageBeats.length; panelIdx++) {
					const beat = pageBeats[panelIdx]!;
					const panelId = uuid();
					panelIds.push(panelId);

					panels.push({
						id: panelId,
						pageId,
						projectId: ctx.projectId,
						index: panelIdx,
						storySectionId: beat.id,
						bbox: {
							x: 0.05,
							y: 0.05 + panelIdx * panelHeight,
							w: 0.9,
							h: panelHeight * 0.95,
						},
						zIndex: panelIdx,
						description: beat.summary,
						cameraFraming: beat.cameraHint,
						characters: beat.charactersPresent.map((charId) => ({ characterId: charId })),
						dialogueLines: [],
						startSec: beat.startSec,
						endSec: beat.endSec,
						qaStatus: "pending",
					});
				}

				pages.push({
					id: pageId,
					projectId: ctx.projectId,
					index: pageIdx,
					storySectionId: pageBeats[0]!.id,
					panelIds,
					panelCount: pageBeats.length,
					readingOrder: panelIds,
					emphasisWeights: {},
					bleedGutter: { bleed: 0, gutter: 0.02 },
					layoutValid: false,
					layoutIssues: [],
				});
			}

			yield* Effect.logInfo(
				`plan_pages: ${pages.length} pages, ${panels.length} panels from ${beats.length} beats`,
			);

			// Persist pages and panels (non-fatal if DB unavailable).
			yield* Effect.tryPromise({
				try: () => Promise.all([
					Promise.all(pages.map((p) => bridge.repo.pageSpecs.create(p))),
					Promise.all(panels.map((p) => bridge.repo.panelSpecs.create(p))),
				]),
				catch: (e) => {
					const msg = e instanceof Error ? e.message : String(e);
					return new Error(`plan_pages: DB persist failed (non-fatal): ${msg}`);
				},
			}).pipe(Effect.catch((e: Error) => Effect.logInfo(e.message)));

			return {
				step: "plan_pages" as const,
				status: "completed" as const,
				pages,
				panels,
			} satisfies PlanPagesResult;
		}),
};

registerStep(PlanPagesStep);
