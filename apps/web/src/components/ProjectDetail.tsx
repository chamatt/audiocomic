'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Project, PageSpec, PanelSpec, StorySection, CharacterProfile, WorldBible, ExportBundle, JobRecord } from '@audiocomic/domain';
import type { PipelineState, StepState } from '@audiocomic/actors';
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
  createProjectActor,
  createBibleActor,
  linkBibleActor,
  type ActorResult,
} from '@/lib/actor-actions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Play, Pause, RotateCcw, SkipForward, RefreshCw, Plus,
  AlertCircle, CheckCircle2, Clock, Loader2, Ban, ZapOff, Zap, ExternalLink,
} from 'lucide-react';
import { PipelineFlow } from '@/components/PipelineFlow';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ChapterCard, type ChapterCardChapter } from '@/components/ChapterCard';
import { ChapterUploadModal } from '@/components/ChapterUploadModal';
import { getBibleWikiActor } from '@/lib/actor-actions';
import { CanvasTab } from '@/components/canvas/CanvasTab';

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

// ---------------------------------------------------------------------------
// Chapters tab
// ---------------------------------------------------------------------------

interface WikiPageEntry {
  id: string;
  type: string;
  title: string;
  content: string;
  confidence: number;
}

function ChaptersTab({ projectId }: { projectId: string }) {
  const [chapters, setChapters] = useState<ChapterCardChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [adding, setAdding] = useState(false);
  const [uploadChapter, setUploadChapter] = useState<{ id: string; title: string } | null>(null);
  const [transcription, setTranscription] = useState<{
    open: boolean;
    chapterId: string;
    chapterTitle: string;
    text: string;
    loading: boolean;
  }>({ open: false, chapterId: '', chapterTitle: '', text: '', loading: false });

  const refreshChapters = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters`);
      if (res.ok) {
        const data = await res.json();
        setChapters(data as ChapterCardChapter[]);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refreshChapters();
  }, [refreshChapters]);

  const onAddChapter = async () => {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/chapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title: newTitle.trim(), description: newDescription.trim() || undefined }),
      });
      if (res.ok) {
        setNewTitle('');
        setNewDescription('');
        setAddOpen(false);
        await refreshChapters();
      }
    } catch {
      /* ignore */
    } finally {
      setAdding(false);
    }
  };

  const onUpload = (chapterId: string) => {
    const ch = chapters.find((c) => c.id === chapterId);
    setUploadChapter({ id: chapterId, title: ch?.title ?? 'Chapter' });
  };

  const onViewTranscription = async (chapterId: string) => {
    const ch = chapters.find((c) => c.id === chapterId);
    setTranscription({
      open: true,
      chapterId,
      chapterTitle: ch?.title ?? 'Chapter',
      text: '',
      loading: true,
    });
    try {
      const res = await fetch(`/api/chapters/${chapterId}/transcription`);
      if (res.ok) {
        const data = await res.json();
        const chunks = (data?.chunks ?? []) as { text?: string; content?: string }[];
        const text = chunks.map((c) => c.text ?? c.content ?? '').filter(Boolean).join('\n\n');
        setTranscription((prev) => ({ ...prev, text: text || '(no transcription available)', loading: false }));
      } else {
        setTranscription((prev) => ({ ...prev, text: '(failed to load transcription)', loading: false }));
      }
    } catch {
      setTranscription((prev) => ({ ...prev, text: '(failed to load transcription)', loading: false }));
    }
  };


  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Chapters</h2>
          <p className="text-sm text-muted-foreground">
            {chapters.length} chapter{chapters.length === 1 ? '' : 's'}
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Chapter
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
            Loading chapters…
          </CardContent>
        </Card>
      ) : chapters.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">No chapters yet. Add one to get started.</p>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Chapter
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {chapters.map((chapter) => (
            <ChapterCard
              key={chapter.id}
              chapter={chapter}
              onUpload={onUpload}
              onViewTranscription={onViewTranscription}
            />
          ))}
        </div>
      )}

      {/* Add chapter dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Chapter</DialogTitle>
            <DialogDescription>Create a new chapter for this project.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="chapter-title">Title</Label>
              <Input
                id="chapter-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Chapter title"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="chapter-description">Description</Label>
              <Textarea
                id="chapter-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Optional description"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>
              Cancel
            </Button>
            <Button onClick={onAddChapter} disabled={adding || !newTitle.trim()}>
              {adding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload modal */}
      {uploadChapter && (
        <ChapterUploadModal
          open={true}
          onOpenChange={(open) => { if (!open) setUploadChapter(null); }}
          chapterId={uploadChapter.id}
          chapterTitle={uploadChapter.title}
          onUploaded={refreshChapters}
        />
      )}

      {/* Transcription dialog */}
      <Dialog
        open={transcription.open}
        onOpenChange={(open) => setTranscription((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Transcription — {transcription.chapterTitle}</DialogTitle>
            <DialogDescription>Full transcription text for this chapter.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[55vh] pr-4">
            {transcription.loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading transcription…
              </div>
            ) : (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{transcription.text}</p>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Knowledge tab
// ---------------------------------------------------------------------------

const WIKI_TYPE_LABELS: Record<string, string> = {
  character: 'Characters',
  location: 'Locations',
  object: 'Objects',
  concept: 'Concepts',
  event: 'Events',
  timeline: 'Timeline',
};

const WIKI_TYPE_ORDER = ['character', 'location', 'object', 'concept', 'event', 'timeline'];

function KnowledgeTab({
  characters,
  worldBible,
}: {
  characters: CharacterProfile[];
  worldBible: WorldBible | null;
}) {
  const [wikiPages, setWikiPages] = useState<WikiPageEntry[]>([]);
  const [wikiLoading, setWikiLoading] = useState(true);
  const [wikiError, setWikiError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getBibleWikiActor('main');
      if (cancelled) return;
      if (res.ok) {
        setWikiPages(res.data as WikiPageEntry[]);
      } else {
        setWikiError(res.error);
      }
      setWikiLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Group wiki pages by type
  const grouped = wikiPages.reduce<Record<string, WikiPageEntry[]>>((acc, page) => {
    const type = page.type in WIKI_TYPE_LABELS ? page.type : 'other';
    (acc[type] ??= []).push(page);
    return acc;
  }, {});
  const groupKeys = Object.keys(grouped).sort(
    (a, b) => WIKI_TYPE_ORDER.indexOf(a) - WIKI_TYPE_ORDER.indexOf(b),
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Characters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Characters</CardTitle>
          <CardDescription>{characters.length} character{characters.length === 1 ? '' : 's'} in the bible</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {characters.length === 0 ? (
            <p className="text-sm text-muted-foreground">No characters defined yet.</p>
          ) : (
            characters.map((c) => (
              <div key={c.id} className="flex flex-col gap-1 pb-3 border-b last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{c.name}</span>
                  <Badge variant="outline" className="capitalize text-xs">{c.role}</Badge>
                </div>
                {c.aliases.length > 0 && (
                  <p className="text-xs text-muted-foreground">Aliases: {c.aliases.join(', ')}</p>
                )}
                <p className="text-sm text-muted-foreground">{c.description}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* World */}
      {worldBible && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">World</CardTitle>
            <CardDescription>Setting and world-building notes</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div>
              <span className="font-medium">Setting: </span>
              <span className="text-muted-foreground">{worldBible.setting}</span>
            </div>
            {worldBible.genre.length > 0 && (
              <div>
                <span className="font-medium">Genre: </span>
                <span className="text-muted-foreground">{worldBible.genre.join(', ')}</span>
              </div>
            )}
            {worldBible.tone && (
              <div>
                <span className="font-medium">Tone: </span>
                <span className="text-muted-foreground">{worldBible.tone}</span>
              </div>
            )}
            {worldBible.artStyle && (
              <div>
                <span className="font-medium">Art Style: </span>
                <span className="text-muted-foreground">{worldBible.artStyle}</span>
              </div>
            )}
            {worldBible.worldRules.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="font-medium">World Rules:</span>
                <ul className="list-disc list-inside text-muted-foreground">
                  {worldBible.worldRules.map((rule, i) => (
                    <li key={i}>{rule}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Wiki pages */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wiki Pages</CardTitle>
          <CardDescription>
            {wikiLoading ? 'Loading…' : `${wikiPages.length} page${wikiPages.length === 1 ? '' : 's'} from the knowledge base`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {wikiError && (
            <p className="text-sm text-destructive">Failed to load wiki: {wikiError}</p>
          )}
          {!wikiLoading && wikiPages.length === 0 && !wikiError && (
            <p className="text-sm text-muted-foreground">No wiki pages yet. They appear after chapter knowledge is ingested.</p>
          )}
          {groupKeys.map((type) => (
            <div key={type} className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {WIKI_TYPE_LABELS[type] ?? type} ({grouped[type]!.length})
              </p>
              {grouped[type]!.map((page) => (
                <div key={page.id} className="pb-2 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{page.title}</span>
                    {page.confidence < 1 && (
                      <Badge variant="outline" className="text-xs">
                        {Math.round(page.confidence * 100)}%
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{page.content}</p>
                </div>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
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
  const [chapters, setChapters] = useState<{ id: string; title: string; index: number; status: string }[]>([]);
  const [activeTab, setActiveTab] = useState<string>(detail.pages.length > 0 ? 'canvas' : 'chapters');
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

  // Fetch chapters for the chapter selector
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/chapters`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setChapters(data.chapters ?? []);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

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



  const steps = pipelineState?.steps ?? [];
  const pipelineStatus = pipelineState?.status ?? 'idle';
  const composePromptsDone = steps.some((s) => s.definition.id === 'compose_prompts' && s.status === 'completed');
  const renderPanelsStarted = steps.some((s) => s.definition.id === 'render_panels' && s.status !== 'pending');
  const atReviewCheckpoint = pipelineStatus === 'paused' && composePromptsDone && !renderPanelsStarted;

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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="canvas">Canvas</TabsTrigger>
          <TabsTrigger value="chapters">Chapters</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Canvas tab */}
        <TabsContent value="canvas" className="h-[calc(100vh-220px)]">
          <CanvasTab projectId={projectId} />
        </TabsContent>

        {/* Chapters tab */}
        <TabsContent value="chapters">
          <ChaptersTab projectId={projectId} />
        </TabsContent>

        {/* Pipeline tab */}
        <TabsContent value="pipeline" className="flex flex-col gap-6">
          {/* Chapter transcription status */}
          {chapters.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {chapters.filter((ch) => ch.status === 'transcribed' || ch.status === 'completed').length}
                {' / '}
                {chapters.length} chapters transcribed
              </span>
            </div>
          )}
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
            </div>
          </div>

          {/* Review checkpoint banner */}
          {atReviewCheckpoint && (
            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Review checkpoint</p>
                    <p className="text-sm text-muted-foreground">
                      Panels are planned and prompts are ready. Review them on the Canvas tab,
                      render individual panels, or click Resume to render all and continue.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setActiveTab('canvas')}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Go to Canvas
                  </Button>
                  <Button
                    size="sm"
                    onClick={onResume}
                    disabled={pipelineBusy}
                  >
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    Render All & Continue
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Flow chart + step list */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
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
        </TabsContent>

        {/* Knowledge tab */}
        <TabsContent value="knowledge">
          <KnowledgeTab characters={detail.characters} worldBible={detail.worldBible} />
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
