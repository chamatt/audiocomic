'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Project, PageSpec, PanelSpec, StorySection, CharacterProfile, WorldBible, ExportBundle, JobRecord } from '@audiocomic/domain';
import type { PipelineState, StepState } from '@audiocomic/actors';
import { regeneratePanelAction, regeneratePageAction, exportProjectAction } from '@/lib/actions';
import {
  startPipelineActor,
  pausePipelineActor,
  resumePipelineActor,
  retryStepActor,
  skipStepActor,
  runStepActor,
  invalidateStepActor,
  getPipelineStatusActor,
  schedulePipelineActor,
  cancelScheduleActor,
  addPipelineStepActor,
  createProjectActor,
  createBibleActor,
  linkBibleActor,
  type ActorResult,
  type AddStepInput,
} from '@/lib/actor-actions';
import { DEFAULT_PIPELINE_STEPS } from '@/lib/default-steps';

export interface ProjectDetailData {
  project: Project;
  job: JobRecord | null;
  pages: (PageSpec & { panels: PanelSpec[]; compositeUrl?: string })[];
  sections: StorySection[];
  characters: CharacterProfile[];
  worldBible: WorldBible | null;
  exports: ExportBundle[];
}

interface Props {
  projectId: string;
  initialProject: Project;
  initialDetail: ProjectDetailData;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280',
  running: '#fbbf24',
  paused: '#a78bfa',
  completed: '#4ade80',
  failed: '#fca5a5',
  skipped: '#6b7280',
  idle: '#6b7280',
  scheduled: '#60a5fa',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#6b7280';
  return (
    <span className="badge" style={{ background: `${color}22`, color }}>
      {status}
    </span>
  );
}

export function ProjectDetail({ projectId, initialProject, initialDetail }: Props) {
  const [detail, setDetail] = useState<ProjectDetailData>(initialDetail);
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);

  // Pipeline actor state
  const [pipelineKey, setPipelineKey] = useState(projectId);
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [scheduleInterval, setScheduleInterval] = useState(60_000);

  const project = detail.project;
  const job = detail.job;
  const progress = job?.progress ?? 0;

  // --- Data refresh ---------------------------------------------------------
  const refreshDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/detail`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data.detail);
      }
    } catch { /* ignore */ }
  }, [projectId]);

  const jobRunning = job?.state === 'running' || job?.state === 'pending';
  useEffect(() => {
    if (!jobRunning) return;
    const interval = setInterval(refreshDetail, 3000);
    return () => clearInterval(interval);
  }, [jobRunning, refreshDetail]);

  // --- Lazy actor initialization (on first visit) --------------------------
  const [actorsReady, setActorsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Create Project + Bible actors lazily; link bible to project.
      // These are fire-and-forget — errors are non-fatal since actors
      // may already exist from a prior visit.
      const projectRes = await createProjectActor(project.name, project.description ?? '');
      if (projectRes.ok) {
        const bibleRes = await createBibleActor(project.name, `Story bible for ${project.name}`);
        if (bibleRes.ok) {
          await linkBibleActor(projectRes.data.key, bibleRes.data.content.id);
        }
      }
      if (!cancelled) setActorsReady(true);
    })();
    return () => { cancelled = true; };
  }, [project.name, project.description]);

  // --- Pipeline actor refresh ----------------------------------------------
  const refreshPipeline = useCallback(async () => {
    const res = await getPipelineStatusActor(pipelineKey);
    if (res.ok) {
      setPipelineState(res.data);
      setPipelineError(null);
    } else {
      setPipelineError(res.error);
    }
  }, [pipelineKey]);

  useEffect(() => {
    if (actorsReady) refreshPipeline();
  }, [actorsReady, refreshPipeline]);

  const actorRunning = pipelineState?.status === 'running';
  useEffect(() => {
    if (!actorRunning) return;
    const interval = setInterval(refreshPipeline, 2000);
    return () => clearInterval(interval);
  }, [actorRunning, refreshPipeline]);

  // --- Pipeline actions -----------------------------------------------------
  const doAction = async (label: string, fn: () => Promise<ActorResult<unknown>>) => {
    setPipelineBusy(true);
    setPipelineError(null);
    const res = await fn();
    if (!res.ok) setPipelineError(`${label}: ${res.error}`);
    await refreshPipeline();
    setPipelineBusy(false);
  };

  const onStart = () => doAction('Start', () => startPipelineActor(pipelineKey));
  const onPause = () => doAction('Pause', () => pausePipelineActor(pipelineKey));
  const onResume = () => doAction('Resume', () => resumePipelineActor(pipelineKey));
  const onRetry = (stepId: string) => doAction(`Retry ${stepId}`, () => retryStepActor(pipelineKey, stepId));
  const onSkip = (stepId: string) => doAction(`Skip ${stepId}`, () => skipStepActor(pipelineKey, stepId));
  const onRunStep = (stepId: string) => doAction(`Run ${stepId}`, () => runStepActor(pipelineKey, stepId));
  const onInvalidate = (stepId: string) => doAction(`Invalidate ${stepId}`, () => invalidateStepActor(pipelineKey, stepId));
  const onSchedule = () => doAction('Schedule', () => schedulePipelineActor(pipelineKey, scheduleInterval));
  const onCancelSchedule = () => doAction('Cancel schedule', () => cancelScheduleActor(pipelineKey));

  const onAddAllSteps = async () => {
    setPipelineBusy(true);
    setPipelineError(null);
    const existingIds = new Set((pipelineState?.steps ?? []).map((s) => s.definition.id));
    const toAdd = DEFAULT_PIPELINE_STEPS.filter((s) => !existingIds.has(s.id));
    for (const step of toAdd) {
      const res = await addPipelineStepActor(pipelineKey, step);
      if (!res.ok) {
        setPipelineError(`Add ${step.id}: ${res.error}`);
        break;
      }
    }
    await refreshPipeline();
    setPipelineBusy(false);
  };

  // --- Legacy actions -------------------------------------------------------
  const onRegeneratePanel = async (panelId: string) => {
    await regeneratePanelAction(projectId, panelId);
    await refreshDetail();
  };
  const onRegeneratePage = async (pageId: string) => {
    await regeneratePageAction(projectId, pageId);
    await refreshDetail();
  };
  const onExport = async (type: 'pages' | 'mp4') => {
    await exportProjectAction(projectId, type);
    await refreshDetail();
  };

  const selectedPage = detail.pages[selectedPageIdx];
  const steps = pipelineState?.steps ?? [];
  const pipelineStatus = pipelineState?.status ?? 'idle';

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>{project.name}</h1>
            <p className="text-sm text-dim mt-2">{project.description ?? 'No description'}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={project.status} />
            <span className="text-sm text-dim">{project.modality}</span>
          </div>
        </div>
        {progress > 0 && (
          <div className="progress-bar mt-4">
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>

      {/* Pipeline Actor Controls */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold" style={{ fontSize: 18 }}>Pipeline Controls</h2>
          <div className="flex items-center gap-2">
            <Link href={`/pipeline/${pipelineKey}`} className="primary" style={{ textDecoration: 'none', padding: '6px 16px', borderRadius: 6, display: 'inline-block' }}>
              View Flow Chart →
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <label className="text-sm text-dim">Pipeline key:</label>
          <input
            value={pipelineKey}
            onChange={(e) => setPipelineKey(e.target.value)}
            style={{ width: 200 }}
            placeholder={projectId}
          />
          <button onClick={refreshPipeline} disabled={pipelineBusy}>Refresh</button>
        </div>

        {pipelineError && (
          <div className="card mb-4" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', padding: '8px 12px' }}>
            {pipelineError}
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          <StatusBadge status={pipelineStatus} />
          {pipelineState?.schedule?.enabled && (
            <span className="text-sm text-dim">
              cron: every {Math.round(pipelineState.schedule.intervalMs / 1000)}s
            </span>
          )}
        </div>

        {/* Lifecycle buttons */}
        <div className="flex items-center gap-2 mb-4">
          <button className="primary" onClick={onStart} disabled={pipelineBusy || pipelineStatus === 'running'}>
            Start
          </button>
          <button onClick={onPause} disabled={pipelineBusy || pipelineStatus !== 'running'}>
            Pause
          </button>
          <button onClick={onResume} disabled={pipelineBusy || pipelineStatus !== 'paused'}>
            Resume
          </button>
          {steps.length === 0 && (
            <button onClick={onAddAllSteps} disabled={pipelineBusy}>
              Add All 15 Steps
            </button>
          )}
        </div>

        {/* Step list */}
        {steps.length > 0 && (
          <div className="stage-list">
            {steps.map((step) => (
              <div key={step.definition.id} className="stage-item" style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: 6,
                marginBottom: 4,
                background: 'var(--bg-card)',
              }}>
                <div className="flex items-center gap-2">
                  <StatusBadge status={step.status} />
                  <span style={{ fontWeight: 500 }}>{step.definition.name}</span>
                  {step.attempts > 0 && (
                    <span className="text-sm text-dim">attempts: {step.attempts}</span>
                  )}
                  {step.summary && (
                    <span className="text-sm text-dim">{step.summary}</span>
                  )}
                  {step.error && (
                    <span className="text-sm" style={{ color: 'var(--danger)' }}>{step.error}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="text-sm"
                    onClick={() => onRunStep(step.definition.id)}
                    disabled={pipelineBusy || step.status === 'running'}
                  >
                    Run
                  </button>
                  <button
                    className="text-sm"
                    onClick={() => onRetry(step.definition.id)}
                    disabled={pipelineBusy || step.status === 'running' || step.status === 'completed'}
                  >
                    Retry
                  </button>
                  <button
                    className="text-sm"
                    onClick={() => onSkip(step.definition.id)}
                    disabled={pipelineBusy || step.status === 'completed' || step.status === 'skipped'}
                  >
                    Skip
                  </button>
                  <button
                    className="text-sm"
                    onClick={() => onInvalidate(step.definition.id)}
                    disabled={pipelineBusy || step.status === 'pending'}
                    title="Mark step and downstream as stale"
                  >
                    Invalidate
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Cron scheduling */}
        <div className="flex items-center gap-2 mt-4" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <label className="text-sm text-dim">Cron interval (ms):</label>
          <input
            type="number"
            value={scheduleInterval}
            onChange={(e) => setScheduleInterval(Number(e.target.value))}
            style={{ width: 120 }}
          />
          <button onClick={onSchedule} disabled={pipelineBusy}>Schedule</button>
          <button onClick={onCancelSchedule} disabled={pipelineBusy}>Cancel</button>
        </div>
      </div>

      {/* Job status (legacy) */}
      {job && (
        <div className="card">
          <h2 className="mb-2 font-bold" style={{ fontSize: 18 }}>Job Status</h2>
          <div className="flex items-center gap-4">
            <StatusBadge status={job.state} />
            <span className="text-sm text-dim">type: {job.type}</span>
            {job.currentStage && <span className="text-sm text-dim">stage: {job.currentStage}</span>}
            {job.error && <span className="text-sm" style={{ color: 'var(--danger)' }}>{job.error}</span>}
          </div>
        </div>
      )}

      {/* Story sections */}
      {detail.sections.length > 0 && (
        <div className="card">
          <h2 className="mb-4 font-bold" style={{ fontSize: 18 }}>Story Sections ({detail.sections.length})</h2>
          <div className="grid grid-3">
            {detail.sections.slice(0, 12).map((s) => (
              <div key={s.id} className="card" style={{ padding: 12 }}>
                <h4 className="font-bold text-sm mb-2">{s.title}</h4>
                <p className="text-sm text-dim">{s.summary?.slice(0, 100) ?? ''}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Characters */}
      {detail.characters.length > 0 && (
        <div className="card">
          <h2 className="mb-4 font-bold" style={{ fontSize: 18 }}>Characters ({detail.characters.length})</h2>
          <div className="grid grid-3">
            {detail.characters.map((c) => (
              <div key={c.id} className="card" style={{ padding: 12 }}>
                <h4 className="font-bold text-sm mb-2">{c.name}</h4>
                <p className="text-sm text-dim">{c.description?.slice(0, 100) ?? ''}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* World bible */}
      {detail.worldBible && (
        <div className="card">
          <h2 className="mb-2 font-bold" style={{ fontSize: 18 }}>World Bible</h2>
          <p className="text-sm text-dim">{detail.worldBible.setting?.slice(0, 300) ?? 'No setting'}</p>
        </div>
      )}

      {/* Pages */}
      {detail.pages.length > 0 && (
        <div className="card">
          <h2 className="mb-4 font-bold" style={{ fontSize: 18 }}>Pages ({detail.pages.length})</h2>

          {/* Page selector */}
          <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
            {detail.pages.map((p, i) => (
              <button
                key={p.id}
                className={i === selectedPageIdx ? 'primary' : ''}
                onClick={() => setSelectedPageIdx(i)}
                style={{ minWidth: 60 }}
              >
                {i + 1}
              </button>
            ))}
          </div>

          {/* Selected page */}
          {selectedPage && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold">Page {selectedPageIdx + 1}</h3>
                <div className="flex gap-2">
                  <button className="text-sm" onClick={() => onRegeneratePage(selectedPage.id)}>
                    Regenerate
                  </button>
                </div>
              </div>

              {selectedPage.compositeUrl && (
                <div className="page-card mb-4">
                  <img src={selectedPage.compositeUrl} alt={`Page ${selectedPageIdx + 1}`} style={{ width: '100%' }} />
                </div>
              )}

              {/* Panels */}
              <div className="grid grid-3">
                {selectedPage.panels.map((panel) => (
                  <div key={panel.id} className="page-card">
                    <div className="page-card-body">
                      <h4 className="font-bold text-sm mb-2">Panel {panel.index + 1}</h4>
                      <p className="text-sm text-dim mb-2">{panel.dialogueLines?.map(d => d.text).join(' ')?.slice(0, 80) ?? ''}</p>
                      <button className="text-sm" onClick={() => onRegeneratePanel(panel.id)}>
                        Regenerate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Exports */}
      {detail.exports.length > 0 && (
        <div className="card">
          <h2 className="mb-4 font-bold" style={{ fontSize: 18 }}>Exports</h2>
          <div className="flex gap-2">
            {detail.exports.map((exp) => (
              <a key={exp.id} href={`/api/exports/${exp.id}/download`} className="page-card" style={{ textDecoration: 'none' }}>
                <div className="page-card-body">
                  <span className="font-bold text-sm">{exp.type}</span>
                  <span className="text-sm text-dim ml-2">{Math.round((exp.sizeBytes ?? 0) / 1024)}KB</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Export actions */}
      <div className="card">
        <h2 className="mb-4 font-bold" style={{ fontSize: 18 }}>Export</h2>
        <div className="flex gap-2">
          <button onClick={() => onExport('pages')}>Export Pages (ZIP)</button>
          <button onClick={() => onExport('mp4')}>Export Motion Comic (MP4)</button>
        </div>
      </div>
    </div>
  );
}
