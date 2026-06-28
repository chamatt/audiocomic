import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext } from "./types.ts";
import { getPrevResult, isPlanPagesResult, isPlanStoryResult } from "./helpers.ts";
import { validatePageLayout, validatePanelSectionRefs } from "@audiocomic/domain";
import type { PageSpec, PanelSpec } from "@audiocomic/domain";

// ─── validate_layout step ───
// Deterministic layout validation for every page produced by plan_pages.
// For each page, filter its panels, run MangaFlow-style layout checks and
// section-reference checks, then persist `layoutValid` / `layoutIssues` on
// the page. Section IDs come from the plan_story result.
//
// Depends on: plan_pages (pages + panels), plan_story (sections -> sectionIds)
// Output: `{ step, status, validPages, invalidPages }`

/** Type guard: an unknown value is a string. */
function isString(v: unknown): v is string {
	return typeof v === "string";
}

/** Type guard: an unknown value is a number. */
function isNumber(v: unknown): v is number {
	return typeof v === "number";
}

/** Type guard: an unknown value is an array. */
function isArray(v: unknown): v is unknown[] {
	return Array.isArray(v);
}

/** Type guard: an unknown value is a BoundingBox-shaped object. */
function isBoundingBox(v: unknown): v is { x: number; y: number; w: number; h: number } {
	if (typeof v !== "object" || v === null) return false;
	const b = v as Record<string, unknown>;
	return (
		isNumber(b.x) && isNumber(b.y) && isNumber(b.w) && isNumber(b.h)
	);
}

/**
 * Type guard: narrow an unknown element of plan_pages.panels to the PanelSpec
 * shape consumed by the domain validators. Checks every field the validators
 * touch: id, pageId, storySectionId, bbox.
 */
function isPanelSpec(v: unknown): v is PanelSpec {
	if (typeof v !== "object" || v === null) return false;
	const p = v as Record<string, unknown>;
	return (
		isString(p.id) &&
		isString(p.pageId) &&
		isString(p.storySectionId) &&
		isBoundingBox(p.bbox)
	);
}

/**
 * Type guard: narrow an unknown element of plan_pages.pages to the PageSpec
 * shape consumed by validatePageLayout. Checks every field the validator
 * touches: id, panelCount, readingOrder.
 */
function isPageSpec(v: unknown): v is PageSpec {
	if (typeof v !== "object" || v === null) return false;
	const p = v as Record<string, unknown>;
	return (
		isString(p.id) &&
		isNumber(p.panelCount) &&
		isArray(p.readingOrder)
	);
}

/** Type guard: a plan_story section element carries a string `id`. */
function isSectionWithId(v: unknown): v is { id: string } {
	if (typeof v !== "object" || v === null) return false;
	const s = v as Record<string, unknown>;
	return isString(s.id);
}

export const ValidateLayoutStep: StepExecutor = {
	type: "validate_layout",
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Extract plan_pages result (pages + panels) and plan_story result
			// (sections -> sectionIds). Both are validated by their guards.
			const planPages = getPrevResult(ctx, "plan_pages", isPlanPagesResult);
			const planStory = getPrevResult(ctx, "plan_story", isPlanStoryResult);

			// Narrow the unknown[] elements to typed specs via guards.
			const pages: PageSpec[] = planPages.pages.filter(isPageSpec);
			const panels: PanelSpec[] = planPages.panels.filter(isPanelSpec);

			// Build the set of valid section IDs for reference checking.
			const sectionIds = new Set<string>(
				planStory.sections.filter(isSectionWithId).map((s) => s.id),
			);

			yield* Effect.logInfo(
				`validate_layout: validating ${pages.length} page(s) against ${panels.length} panel(s)`,
			);

			let validPages = 0;
			let invalidPages = 0;

			for (const page of pages) {
				// Filter panels belonging to this page by pageId.
				const pagePanels = panels.filter((p) => p.pageId === page.id);

				// Run deterministic layout + section-reference checks.
				const layoutResult = validatePageLayout(page, pagePanels);
				const refResult = validatePanelSectionRefs(pagePanels, sectionIds);
				const issues = [...layoutResult.errors, ...refResult.errors];

				// Persist validation outcome on the page.
				yield* Effect.tryPromise(() =>
					bridge.repo.pageSpecs.patch(page.id, {
						layoutValid: issues.length === 0,
						layoutIssues: issues,
					}),
				);

				if (issues.length === 0) {
					validPages++;
				} else {
					invalidPages++;
					yield* Effect.logInfo(
						`validate_layout: page ${page.index} has ${issues.length} issue(s): ${issues.join("; ")}`,
					);
				}
			}

			yield* Effect.logInfo(
				`validate_layout: ${validPages} valid, ${invalidPages} invalid`,
			);

			return {
				step: "validate_layout" as const,
				status: "completed" as const,
				validPages,
				invalidPages,
			};
		}),
};

registerStep(ValidateLayoutStep);
