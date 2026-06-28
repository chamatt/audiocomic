// Shared helpers for step executors — safe extraction of previous step results.

/** Type guard: does an unknown value have a string field? */
export function hasStringField<T extends string>(v: unknown, field: T): v is Record<T, string> {
	return typeof v === "object" && v !== null && field in v && typeof (v as Record<string, unknown>)[field] === "string";
}

/** Safely extract a previous step's result, narrowing with a guard. */
export function getPrevResult<T>(ctx: { previousResults: Map<string, unknown> }, stepId: string, guard: (v: unknown) => v is T): T {
	const raw = ctx.previousResults.get(stepId);
	if (raw === undefined) throw new Error(`Missing previous step result: ${stepId}`);
	if (!guard(raw)) throw new Error(`Previous step result ${stepId} has unexpected shape`);
	return raw;
}

/** Guard for normalize result. */
export function isNormalizeResult(v: unknown): v is { step: string; status: string; audioPath?: string; textContent?: string; durationSec?: number } {
	return typeof v === "object" && v !== null && "step" in v && "status" in v;
}

/** Guard for transcribe result. */
export function isTranscribeResult(v: unknown): v is { step: string; status: string; chunks: unknown[]; durationSec: number } {
	return typeof v === "object" && v !== null && "step" in v && "chunks" in v && Array.isArray((v as Record<string, unknown>).chunks);
}

/** Guard for segment result. */
export function isSegmentResult(v: unknown): v is { step: string; status: string; fullText: string; chunkCount: number } {
	return typeof v === "object" && v !== null && "step" in v && "fullText" in v && typeof (v as Record<string, unknown>).fullText === "string";
}

/** Guard for plan_story result. */
export function isPlanStoryResult(v: unknown): v is { step: string; status: string; sections: unknown[]; characters: unknown[]; worldBible: unknown } {
	return typeof v === "object" && v !== null && "step" in v && "sections" in v && Array.isArray((v as Record<string, unknown>).sections);
}

/** Guard for plan_pages result. */
export function isPlanPagesResult(v: unknown): v is { step: string; status: string; pages: unknown[]; panels: unknown[] } {
	return typeof v === "object" && v !== null && "step" in v && "pages" in v && Array.isArray((v as Record<string, unknown>).pages);
}

/** Guard for compose_prompts result. */
export function isComposePromptsResult(v: unknown): v is { step: string; status: string; panelPrompts: Map<string, string> } {
	return typeof v === "object" && v !== null && "step" in v && "panelPrompts" in v;
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
