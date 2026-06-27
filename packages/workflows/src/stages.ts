import type { ProjectStage, StageState } from '@audiocomic/domain';

// ============================================================================
// Pipeline stage definitions — ordered execution plan
// ============================================================================

export interface StageDefinition {
  stage: ProjectStage;
  label: string;
  // Stages that must complete before this one can run
  dependsOn: ProjectStage[];
  // Whether this stage is skippable (e.g. diarization for single-speaker)
  optional?: boolean;
}

export const PIPELINE_STAGES: StageDefinition[] = [
  { stage: 'normalize', label: 'Normalize source', dependsOn: [] },
  { stage: 'transcribe', label: 'Transcribe audio / parse text', dependsOn: ['normalize'] },
  { stage: 'segment', label: 'Segment into chapters, scenes, beats', dependsOn: ['transcribe'] },
  { stage: 'plan_story', label: 'Plan story structure', dependsOn: ['segment'] },
  { stage: 'build_bibles', label: 'Build world and character bibles', dependsOn: ['plan_story'] },
  { stage: 'section_memory', label: 'Build section memory embeddings', dependsOn: ['plan_story', 'build_bibles'] },
  { stage: 'plan_pages', label: 'Plan pages and panels', dependsOn: ['section_memory'] },
  { stage: 'validate_layout', label: 'Validate page layouts', dependsOn: ['plan_pages'] },
  { stage: 'compose_prompts', label: 'Compose render prompts', dependsOn: ['validate_layout'] },
  { stage: 'render_panels', label: 'Render panel images', dependsOn: ['compose_prompts'] },
  { stage: 'panel_qa', label: 'Panel QA and consistency checks', dependsOn: ['render_panels'] },
  { stage: 'compose_pages', label: 'Compose page images', dependsOn: ['panel_qa'] },
  { stage: 'lettering', label: 'Place lettering overlays', dependsOn: ['compose_pages'] },
  { stage: 'export_static', label: 'Export static comic pages', dependsOn: ['lettering'] },
  { stage: 'export_motion', label: 'Export narrated motion comic', dependsOn: ['lettering'] },
];

export const STAGE_ORDER: ProjectStage[] = PIPELINE_STAGES.map((s) => s.stage);

export function getStageDefinition(stage: ProjectStage): StageDefinition | undefined {
  return PIPELINE_STAGES.find((s) => s.stage === stage);
}

export function getStagesAfter(stage: ProjectStage): ProjectStage[] {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx < 0) return [];
  return STAGE_ORDER.slice(idx + 1);
}

export function getStagesBefore(stage: ProjectStage): ProjectStage[] {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx < 0) return [];
  return STAGE_ORDER.slice(0, idx);
}

export function canRunStage(
  stage: ProjectStage,
  stageStates: Map<ProjectStage, StageState>,
): boolean {
  const def = getStageDefinition(stage);
  if (!def) return false;
  return def.dependsOn.every((dep) => {
    const state = stageStates.get(dep);
    return state === 'completed' || state === 'skipped';
  });
}

export function nextStage(
  stageStates: Map<ProjectStage, StageState>,
): ProjectStage | null {
  for (const stage of STAGE_ORDER) {
    const state = stageStates.get(stage);
    if (state === 'pending' || state === undefined) {
      if (canRunStage(stage, stageStates)) return stage;
    }
  }
  return null;
}

export function computeProgress(stageStates: Map<ProjectStage, StageState>): number {
  let completed = 0;
  for (const stage of STAGE_ORDER) {
    const state = stageStates.get(stage);
    if (state === 'completed' || state === 'skipped') completed++;
  }
  return completed / STAGE_ORDER.length;
}
