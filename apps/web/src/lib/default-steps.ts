import type { AddStepInput } from './actor-actions';

/**
 * The 9 default pipeline steps with their DAG dependencies.
 * Matches the actor package's `default-steps.ts`.
 *
 * normalize and transcribe are NOT included — those happen per-chapter
 * on upload via ChapterActor. The pipeline starts with ingest_knowledge
 * (project-level), then build_bibles, then plan_chapters (per-chapter
 * loop with auto-pause for review).
 */
export const DEFAULT_PIPELINE_STEPS: AddStepInput[] = [
  { id: 'ingest_knowledge', name: 'Ingest Knowledge',    type: 'ingest_knowledge', config: {}, dependsOn: [] },
  { id: 'build_bibles',     name: 'Build Bibles',        type: 'build_bibles',     config: {}, dependsOn: ['ingest_knowledge'] },
  { id: 'plan_chapters',    name: 'Plan Chapters',       type: 'plan_chapters',    config: {}, dependsOn: ['build_bibles'], pauseAfter: true },
  { id: 'render_panels',    name: 'Render Panels',       type: 'render_panels',    config: {}, dependsOn: ['plan_chapters'] },
  { id: 'panel_qa',         name: 'Panel QA',            type: 'panel_qa',         config: {}, dependsOn: ['render_panels'] },
  { id: 'compose_pages',    name: 'Compose Pages',       type: 'compose_pages',    config: {}, dependsOn: ['render_panels'] },
  { id: 'lettering',        name: 'Lettering',           type: 'lettering',        config: {}, dependsOn: ['compose_pages'] },
  { id: 'export_static',    name: 'Export Static',       type: 'export_static',    config: {}, dependsOn: ['compose_pages'] },
  { id: 'export_motion',    name: 'Export Motion',       type: 'export_motion',    config: {}, dependsOn: ['compose_pages'] },
];
