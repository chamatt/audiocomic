'use client';

import { useEffect, useState, useCallback } from 'react';
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
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Play, Pause, RotateCcw, SkipForward, RefreshCw, Plus, Download,
  AlertCircle, CheckCircle2, Clock, Loader2, Ban, ZapOff, Zap,
} from 'lucide-react';
import { PipelineFlow } from '@/components/PipelineFlow';

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

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { variant: 'default' | 'destructive' | 'success' | 'warning' | 'outline'; icon: typeof Clock }> = {
  pending: { variant: 'outline', icon: Clock },
  running: { variant: 'warning', icon: Loader2 },
  paused: { variant: 'default', icon: Pause },
  completed: { variant: 'success', icon: CheckCircle2 },
  failed: { variant: 'destructive', icon: AlertCircle },
  skipped: { variant: 'outline', icon: SkipForward },
  stale: { variant: 'warning', icon: RefreshCw },
  idle: { variant: 'outline', icon: Clock },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending!;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1.5">
      <Icon className={cn('h-3 w-3', status === 'running' && 'animate-spin')} />
      {status}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Step card
// ---------------------------------------------------------------------------

function StepCard({
  step,
  busy,
  onRun,
  onRetry,
  onSkip,
  onInvalidate,
}: {
  step: StepState;
  busy: boolean;
  onRun: (id: string) => void;
  onRetry: (id: string) => void;
  onSkip: (id: string) => void;
  onInvalidate: (id: string) => void;
}) {
  const isRunning = step.status === 'running';
  const isCompleted = step.status === 'completed';
  const isSkipped = step.status === 'skipped';

  return (
    <Card className={cn(
      'transition-colors',
      isRunning && 'border-warning/50',
      step.status === 'failed' && 'border-destructive/50',
    )}>
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <StatusBadge status={step.status} />
            <div className="min-w-0 flex-1">
              <p className={cn(
                'text-sm font-medium truncate',
                isSkipped && 'line-through text-muted-foreground',
              )}>
                {step.definition.name}
              </p>
              {step.summary && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{step.summary}</p>
              )}
              {step.error && (
                <p className="text-xs text-destructive truncate mt-0.5">{step.error}</p>
              )}
            </div>
            {step.attempts > 0 && (
              <span className="text-xs text-muted-foreground shrink-0">
                attempt {step.attempts}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => onRun(step.definition.id)}
                    disabled={busy || isRunning}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Run step</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => onRetry(step.definition.id)}
                    disabled={busy || isRunning || isCompleted}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Retry</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => onSkip(step.definition.id)}
                    disabled={busy || isCompleted || isSkipped}
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Skip</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => onInvalidate(step.definition.id)}
                    disabled={busy || step.status === 'pending'}
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Invalidate downstream</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Artifacts tab
// ---------------------------------------------------------------------------

function ArtifactsTab({ detail, onRegeneratePanel, onRegeneratePage, onExport }: {
  detail: ProjectDetailData;
  onRegeneratePanel: (panelId: string) => void;
  onRegeneratePage: (pageId: string) => void;
  onExport: (type: 'pages' | 'mp4') => void;
}) {
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);
  const selectedPage = detail.pages[selectedPageIdx];

  if (detail.pages.length === 0 && detail.exports.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <p className="text-muted-foreground">No artifacts yet. Run the pipeline to generate pages and exports.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Pages */}
      {detail.pages.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Pages ({detail.pages.length})
            </h3>
          </div>

          {/* Page selector */}
          <div className="flex gap-2 flex-wrap">
            {detail.pages.map((p, i) => (
              <Button
                key={p.id}
                size="sm"
                variant={i === selectedPageIdx ? 'default' : 'outline'}
                onClick={() => setSelectedPageIdx(i)}
                className="h-8 w-8 p-0"
              >
                {i + 1}
              </Button>
            ))}
          </div>

          {/* Selected page */}
          {selectedPage && (
            <div className="flex flex-col gap-4">
              {selectedPage.compositeUrl && (
                <Card className="overflow-hidden">
                  <img
                    src={selectedPage.compositeUrl}
                    alt={`Page ${selectedPageIdx + 1}`}
                    className="w-full"
                  />
                </Card>
              )}

              {/* Panels */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {selectedPage.panels.map((panel) => (
                  <Card key={panel.id} className="overflow-hidden">
                    <CardContent className="p-4">
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        Panel {panel.index + 1}
                      </p>
                      <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                        {panel.dialogueLines?.map(d => d.text).join(' ') ?? ''}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onRegeneratePanel(panel.id)}
                      >
                        <RotateCcw className="h-3 w-3 mr-1.5" />
                        Regenerate
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Separator />

      {/* Story sections */}
      {detail.sections.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Story Sections ({detail.sections.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {detail.sections.slice(0, 12).map((s) => (
              <Card key={s.id}>
                <CardContent className="py-4">
                  <p className="text-sm font-medium mb-1">{s.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-3">{s.summary ?? ''}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Characters */}
      {detail.characters.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Characters ({detail.characters.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {detail.characters.map((c) => (
              <Card key={c.id}>
                <CardContent className="py-4">
                  <p className="text-sm font-medium mb-1">{c.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-3">{c.description ?? ''}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* World bible */}
      {detail.worldBible && (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            World Bible
          </h3>
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground line-clamp-6">
                {detail.worldBible.setting ?? 'No setting'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />

      {/* Exports */}
      {detail.exports.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Exports
          </h3>
          <div className="flex gap-3 flex-wrap">
            {detail.exports.map((exp) => (
              <a key={exp.id} href={`/api/exports/${exp.id}/download`}>
                <Card className="hover:border-primary/50 transition-colors">
                  <CardContent className="py-3 px-4 flex items-center gap-3">
                    <Download className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-sm font-medium">{exp.type}</p>
                      <p className="text-xs text-muted-foreground">{Math.round((exp.sizeBytes ?? 0) / 1024)} KB</p>
                    </div>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Export actions */}
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => onExport('pages')}>
          <Download className="h-4 w-4 mr-2" />
          Export Pages (ZIP)
        </Button>
        <Button variant="outline" onClick={() => onExport('mp4')}>
          <Download className="h-4 w-4 mr-2" />
          Export Motion Comic (MP4)
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectDetail({ projectId, initialProject, initialDetail }: Props) {
  const [detail, setDetail] = useState<ProjectDetailData>(initialDetail);
  const [pipelineKey] = useState(projectId);
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [actorsReady, setActorsReady] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const project = detail.project;

  // --- Data refresh ---
  const refreshDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/detail`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data.detail);
      }
    } catch { /* ignore */ }
  }, [projectId]);

  // --- Lazy actor init ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
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

  // --- Pipeline refresh ---
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

  // --- Pipeline actions ---
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

  // --- Legacy actions ---
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

  const steps = pipelineState?.steps ?? [];
  const pipelineStatus = pipelineState?.status ?? 'idle';
  const hasSteps = steps.length > 0;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            <StatusBadge status={project.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {project.description ?? 'No description'}
          </p>
          <p className="text-xs text-muted-foreground capitalize">{project.modality}</p>
        </div>
      </div>

      {/* Error banner */}
      {pipelineError && (
        <Card className="mb-6 border-destructive/50">
          <CardContent className="py-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{pipelineError}</p>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="pipeline">
        <TabsList className="mb-6">
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Pipeline tab */}
        <TabsContent value="pipeline" className="flex flex-col gap-6">
          {/* Pipeline controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={pipelineStatus} />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={onStart}
                disabled={pipelineBusy || pipelineStatus === 'running'}
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                Start
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onPause}
                disabled={pipelineBusy || pipelineStatus !== 'running'}
              >
                <Pause className="h-3.5 w-3.5 mr-1.5" />
                Pause
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onResume}
                disabled={pipelineBusy || pipelineStatus !== 'paused'}
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                Resume
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={refreshPipeline}
                disabled={pipelineBusy}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Refresh
              </Button>
              {!hasSteps && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onAddAllSteps}
                  disabled={pipelineBusy}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add All 15 Steps
                </Button>
              )}
            </div>
          </div>

          {/* Flow chart + step list */}
          {hasSteps ? (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
              {/* Flow chart */}
              <Card className="overflow-hidden">
                <div className="h-[600px] w-full">
                  <PipelineFlow
                    pipelineKey={pipelineKey}
                    state={pipelineState}
                    onRunStep={onRunStep}
                    onRetryStep={onRetry}
                    onSkipStep={onSkip}
                    onInvalidateStep={onInvalidate}
                    onRunAll={onStart}
                    onPause={onPause}
                    onResume={onResume}
                    onSelectStep={setSelectedStepId}
                    selectedStepId={selectedStepId}
                  />
                </div>
              </Card>

              {/* Step list sidebar */}
              <ScrollArea className="h-[600px] pr-4">
                <div className="flex flex-col gap-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Steps ({steps.length})
                  </p>
                  {steps.map((step) => (
                    <StepCard
                      key={step.definition.id}
                      step={step}
                      busy={pipelineBusy}
                      onRun={onRunStep}
                      onRetry={onRetry}
                      onSkip={onSkip}
                      onInvalidate={onInvalidate}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <Card>
              <CardContent className="py-16 text-center">
                <p className="text-muted-foreground mb-4">
                  No pipeline steps yet. Add steps to start processing.
                </p>
                <Button onClick={onAddAllSteps} disabled={pipelineBusy}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add All 15 Steps
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Artifacts tab */}
        <TabsContent value="artifacts">
          <ArtifactsTab
            detail={detail}
            onRegeneratePanel={onRegeneratePanel}
            onRegeneratePage={onRegeneratePage}
            onExport={onExport}
          />
        </TabsContent>

        {/* Settings tab */}
        <TabsContent value="settings">
          <div className="flex flex-col gap-6 max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Project Info</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Name</Label>
                  <Input value={project.name} readOnly />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Description</Label>
                  <Input value={project.description ?? ''} readOnly />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Modality</Label>
                  <Input value={project.modality} readOnly className="capitalize" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Provider Settings</CardTitle>
                <CardDescription>LLM, transcription, and image rendering configuration</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label>LLM Model</Label>
                    <Input value={project.providerSettings?.llmModel ?? 'default'} readOnly />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Image Model</Label>
                    <Input value={project.providerSettings?.imageModel ?? 'default'} readOnly />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Renderer</Label>
                    <Input value={project.providerSettings?.rendererBackend ?? 'default'} readOnly />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Transcription</Label>
                    <Input value={project.providerSettings?.transcriptionProvider ?? 'default'} readOnly />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
