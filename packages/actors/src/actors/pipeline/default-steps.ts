import type { StepDefinition, StepState } from "../../lib/schemas.ts";

/**
 * The 10 default pipeline steps with their DAG dependencies.
 *
 * Flow:
 *   ingest_knowledge (project-level: embeddings + wiki + character states)
 *   → build_bibles (project-level: enrich KB with bible builder agent)
 *   → generate_refs (project-level: face reference images for each character)
 *   → plan_chapters (per-chapter: segment → plan_story → plan_pages → compose_prompts)
 *   → layout_panels (per-chapter: re-lays-out pages/panels from beats with full-width layout)
 *   → 🟡 AUTO-PAUSE (review on canvas, render individual panels or all)
 *   → render_panels (reads from DB, skips already-rendered panels)
 *
 * normalize and transcribe are NOT included — those happen per-chapter
 * on upload via ChapterActor.
 */
export const DEFAULT_STEP_DEFINITIONS: StepDefinition[] = [
	{ id: "ingest_knowledge", name: "Ingest Knowledge", type: "ingest_knowledge", config: {}, dependsOn: [] },
	{ id: "build_bibles", name: "Build Bibles", type: "build_bibles", config: {}, dependsOn: ["ingest_knowledge"] },
	{ id: "generate_refs", name: "Generate Refs", type: "generate_refs", config: {}, dependsOn: ["build_bibles"] },
	{ id: "plan_chapters", name: "Plan Chapters", type: "plan_chapters", config: {}, dependsOn: ["generate_refs"], pauseAfter: true },
	{ id: "layout_panels", name: "Layout Panels", type: "layout_panels", config: {}, dependsOn: ["plan_chapters"] },
	{ id: "render_panels", name: "Render Panels", type: "render_panels", config: {}, dependsOn: ["layout_panels"] },
	{ id: "panel_qa", name: "Panel QA", type: "panel_qa", config: {}, dependsOn: ["render_panels"] },
	{ id: "compose_pages", name: "Compose Pages", type: "compose_pages", config: {}, dependsOn: ["render_panels"] },
	{ id: "lettering", name: "Lettering", type: "lettering", config: {}, dependsOn: ["compose_pages"] },
	{ id: "export_static", name: "Export Static", type: "export_static", config: {}, dependsOn: ["compose_pages"] },
	{ id: "export_motion", name: "Export Motion", type: "export_motion", config: {}, dependsOn: ["compose_pages"] },
];

/** Default initial steps — all 9, each in "pending" status. */
export function createDefaultSteps(): StepState[] {
	return DEFAULT_STEP_DEFINITIONS.map((definition) => ({
		definition,
		status: "pending" as const,
		attempts: 0,
	}));
}
