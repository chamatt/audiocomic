import type { StepDefinition, StepState } from "../../lib/schemas.ts";

/**
 * The 14 default pipeline steps with their DAG dependencies.
 *
 * normalize and transcribe are NOT included — those happen per-chapter
 * on upload via ChapterActor. This pipeline starts with ingest_knowledge
 * (the "rebuild index" step) which builds embeddings + wiki from all
 * transcribed chapters, then proceeds to story planning and rendering.
 *
 * The pipeline auto-pauses after compose_prompts (pauseAfter: true) so
 * the user can review planned panels on the canvas before rendering.
 *
 * This is the single source of truth for the default pipeline —
 * the web app's `default-steps.ts` mirrors this for UI rendering.
 */
export const DEFAULT_STEP_DEFINITIONS: StepDefinition[] = [
	{ id: "ingest_knowledge", name: "Ingest Knowledge", type: "ingest_knowledge", config: {}, dependsOn: [] },
	{ id: "segment", name: "Segment", type: "segment", config: {}, dependsOn: ["ingest_knowledge"] },
	{ id: "plan_story", name: "Plan Story", type: "plan_story", config: {}, dependsOn: ["segment"] },
	{ id: "build_bibles", name: "Build Bibles", type: "build_bibles", config: {}, dependsOn: ["plan_story"] },
	{ id: "section_memory", name: "Section Memory", type: "section_memory", config: {}, dependsOn: ["plan_story"] },
	{ id: "plan_pages", name: "Plan Pages", type: "plan_pages", config: {}, dependsOn: ["plan_story"] },
	{ id: "validate_layout", name: "Validate Layout", type: "validate_layout", config: {}, dependsOn: ["plan_pages", "plan_story"] },
	{ id: "compose_prompts", name: "Compose Prompts", type: "compose_prompts", config: {}, dependsOn: ["plan_pages", "plan_story"], pauseAfter: true },
	{ id: "render_panels", name: "Render Panels", type: "render_panels", config: {}, dependsOn: ["compose_prompts", "plan_pages", "plan_story"] },
	{ id: "panel_qa", name: "Panel QA", type: "panel_qa", config: {}, dependsOn: ["render_panels", "plan_pages"] },
	{ id: "compose_pages", name: "Compose Pages", type: "compose_pages", config: {}, dependsOn: ["plan_pages", "render_panels"] },
	{ id: "lettering", name: "Lettering", type: "lettering", config: {}, dependsOn: ["compose_pages", "plan_pages"] },
	{ id: "export_static", name: "Export Static", type: "export_static", config: {}, dependsOn: ["compose_pages"] },
	{ id: "export_motion", name: "Export Motion", type: "export_motion", config: {}, dependsOn: ["compose_pages", "plan_pages"] },
];

/** Default initial steps — all 14, each in "pending" status. */
export function createDefaultSteps(): StepState[] {
	return DEFAULT_STEP_DEFINITIONS.map((definition) => ({
		definition,
		status: "pending" as const,
		attempts: 0,
	}));
}
