import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { getPrevResult, isRenderPanelsResult } from "./helpers.ts";
import type { PanelSpec } from "@audiocomic/domain";

// ─── panel_qa step ───
// For MVP, marks every rendered panel as QA-passed. Reads the panelImageKeys
// map from render_panels (only panels that were actually rendered) and the
// panel specs from the DB, then patches each rendered panel's qaStatus
// to 'passed' in the DB.

export interface PanelQaResult {
	step: "panel_qa";
	status: "completed";
	passedCount: number;
}

export const PanelQaStep: StepExecutor = {
	type: "panel_qa",
	inputs: ["render_panels"],
	outputs: ["panel_qa"],
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Read render_panels result for the panelImageKeys map (rendered panels).
			const renderPanels = getPrevResult(ctx, "render_panels", isRenderPanelsResult);
			const panelImageKeys = renderPanels.panelImageKeys;

			// Read panel specs from the DB.
			const allPanels = yield* Effect.tryPromise({
				try: () => bridge.repo.panelSpecs.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			// Only panels that were actually rendered have a renderResultId.
			const renderedPanels = allPanels.filter(
				(p) => p.renderResultId !== undefined,
			) as PanelSpec[];

			// Mark every rendered panel as QA-passed.
			let passedCount = 0;
			for (const panel of renderedPanels) {
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
