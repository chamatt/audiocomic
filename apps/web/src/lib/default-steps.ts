import type { AddStepInput } from './actor-actions';

/**
 * The 14 default pipeline steps with their DAG dependencies.
 * Matches the actor package's `default-steps.ts`.
 *
 * normalize and transcribe are NOT included — those happen per-chapter
 * on upload via ChapterActor. The pipeline starts with ingest_knowledge
 * (the "rebuild index" step) which builds embeddings + wiki from all
 * transcribed chapters.
 */
export const DEFAULT_PIPELINE_STEPS: AddStepInput[] = [
  { id: 'ingest_knowledge', name: 'Ingest Knowledge',    type: 'ingest_knowledge', config: {}, dependsOn: [] },
  { id: 'segment',          name: 'Segment',             type: 'segment',          config: {}, dependsOn: ['ingest_knowledge'] },
  { id: 'build_bibles',     name: 'Build Bibles',        type: 'build_bibles',     config: {}, dependsOn: ['plan_story'] },
  { id: 'section_memory',   name: 'Section Memory',      type: 'section_memory',   config: {}, dependsOn: ['plan_story'] },
  { id: 'plan_pages',       name: 'Plan Pages',          type: 'plan_pages',       config: {}, dependsOn: ['plan_story'] },
  { id: 'validate_layout',  name: 'Validate Layout',     type: 'validate_layout',  config: {}, dependsOn: ['plan_pages', 'plan_story'] },
  { id: 'compose_prompts',  name: 'Compose Prompts',     type: 'compose_prompts',  config: {}, dependsOn: ['plan_pages', 'plan_story'], pauseAfter: true },
  { id: 'render_panels',    name: 'Render Panels',       type: 'render_panels',    config: {}, dependsOn: ['compose_prompts', 'plan_pages', 'plan_story'] },
  { id: 'panel_qa',         name: 'Panel QA',            type: 'panel_qa',         config: {}, dependsOn: ['render_panels', 'plan_pages'] },
  { id: 'compose_pages',    name: 'Compose Pages',       type: 'compose_pages',    config: {}, dependsOn: ['plan_pages', 'render_panels'] },
  { id: 'lettering',        name: 'Lettering',           type: 'lettering',        config: {}, dependsOn: ['compose_pages', 'plan_pages'] },
  { id: 'export_static',    name: 'Export Static',       type: 'export_static',    config: {}, dependsOn: ['compose_pages'] },
  { id: 'export_motion',    name: 'Export Motion',       type: 'export_motion',    config: {}, dependsOn: ['compose_pages', 'plan_pages'] },
];
