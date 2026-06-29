// Shared helpers for step executors — safe extraction of previous step results.

import { Effect } from "effect";

/** Type guard: does an unknown value have a string field? */
export function hasStringField<T extends string>(v: unknown, field: T): v is Record<T, string> {
	return typeof v === "object" && v !== null && field in v && typeof (v as Record<string, unknown>)[field] === "string";
}

/**
 * Safely extract a previous step's result, narrowing with a guard.
 * Returns an Effect that fails with a descriptive error if the result
 * is missing or has an unexpected shape — no raw throws.
 */
export function getPrevResult<T>(
	ctx: { previousResults: Map<string, unknown> },
	stepId: string,
	guard: (v: unknown) => v is T,
): Effect.Effect<T, Error> {
	const raw = ctx.previousResults.get(stepId);
	if (raw === undefined) return Effect.fail(new Error(`Missing previous step result: ${stepId}`));
	if (!guard(raw)) return Effect.fail(new Error(`Previous step result ${stepId} has unexpected shape`));
	return Effect.succeed(raw);
}


/** Guard for render_panels result. */
export function isRenderPanelsResult(v: unknown): v is { step: string; status: string; renderedCount: number; panelImageKeys: Map<string, string> } {
	return typeof v === "object" && v !== null && "step" in v && "renderedCount" in v;
}

/** Guard for compose_pages result. */
export function isComposePagesResult(v: unknown): v is { step: string; status: string; pageImageKeys: Map<string, string> } {
	return typeof v === "object" && v !== null && "step" in v && "pageImageKeys" in v;
}

/** Guard for lettering result. */
export function isLetteringResult(v: unknown): v is { step: string; status: string; letteringKeys: Map<string, string> } {
	return typeof v === "object" && v !== null && "step" in v && "letteringKeys" in v;
}

/** Guard for export_static result. */
export function isExportStaticResult(v: unknown): v is { step: string; status: string; exportId: string; sizeBytes: number } {
	return typeof v === "object" && v !== null && "step" in v && "exportId" in v;
}
