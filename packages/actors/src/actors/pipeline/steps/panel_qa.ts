import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { getPrevResult, isPlanPagesResult, isRenderPanelsResult } from "./helpers.ts";
import type { PanelSpec } from "@audiocomic/domain";

// ─── panel_qa step ───
// For MVP, marks every rendered panel as QA-passed. Reads the panelImageKeys
// map from render_panels (only panels that were actually rendered) and the
// panel specs from plan_pages, then patches each rendered panel's qaStatus
// to 'passed' in the DB.

export interface PanelQaResult {
	step: "panel_qa";
	status: "completed";
	passedCount: number;
}

/** Type guard: narrows an unknown to a PanelSpec with the fields we need. */
function isPanelSpec(v: unknown): v is PanelSpec {
	return (
		typeof v === "object" &&
		v !== null &&
		"id" in v &&
		typeof (v as Record<string, unknown>).id === "string"
	);
}

export const PanelQaStep: StepExecutor = {
	type: "panel_qa",
	inputs: ["render_panels", "plan_pages"],
	outputs: ["panel_qa"],
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Read render_panels result for the panelImageKeys map (rendered panels).
			const renderPanels = getPrevResult(ctx, "render_panels", isRenderPanelsResult);
			const panelImageKeys = renderPanels.panelImageKeys;

			// Read plan_pages result for the panel specs.
			const planPages = getPrevResult(ctx, "plan_pages", isPlanPagesResult);
			const panels = planPages.panels.filter(isPanelSpec);

			// Mark every panel that has a rendered image as QA-passed.
			let passedCount = 0;
			for (const panel of panels) {
				if (!panelImageKeys.has(panel.id)) continue;
				yield* Effect.tryPromise({
					try: () => bridge.repo.panelSpecs.patch(panel.id, { qaStatus: "passed" }),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				passedCount++;
			}

			yield* Effect.logInfo(
				`panel_qa: marked ${passedCount} panels as passed`,
			);

			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "panel_qa" as const,
					status: "completed" as const,
					passedCount,
				} satisfies PanelQaResult,
				summary: `${passedCount} panels passed QA`,
			} satisfies StepOutput;
		}),
};

registerStep(PanelQaStep);
