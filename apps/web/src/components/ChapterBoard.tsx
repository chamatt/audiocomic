'use client';

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Upload, Loader2, Library } from 'lucide-react';
import { ChapterUploadModal } from '@/components/ChapterUploadModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of stage_progress jsonb column: { current, total, detail? } */
interface StageProgress {
  current: number;
  total: number;
  detail?: string;
}

/** Chapter row as returned by GET /api/projects/[id]/chapters */
interface BoardChapter {
  id: string;
  index: number;
  title: string;
  description?: string;
  status: string;
  stage: string;
  stageProgress?: StageProgress | null;
  durationSec?: number;
  sourceAssetId?: string;
}


/** Chapter from the library (other projects) available for import */
interface LibraryChapter {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  index: number;
  stage: string;
  transcriptionStatus: string;
  durationSec?: number;
  sectionCount: number;
  pageCount: number;
  panelCount: number;
  renderedPanelCount: number;
}
interface ChapterBoardProps {
  projectId: string;
  onReview: (chapterId: string) => void;
}

// ---------------------------------------------------------------------------
// Stage config
// ---------------------------------------------------------------------------

type BadgeVariant = 'default' | 'destructive' | 'outline' | 'success' | 'warning';

interface StageConfig {
  label: string;
  variant: BadgeVariant;
  /** Whether this stage shows a progress bar */
  showProgress: boolean;
}

const STAGE_CONFIG: Record<string, StageConfig> = {
  pending: { label: 'Pending', variant: 'outline', showProgress: false },
  transcribing: { label: '🎙️ Transcribing', variant: 'default', showProgress: true },
  ingesting: { label: '🧠 Ingesting', variant: 'default', showProgress: true },
  planning: { label: '📖 Planning', variant: 'default', showProgress: true },
  ready_for_review: { label: '🎨 Ready for Review', variant: 'warning', showProgress: false },
  rendering: { label: '🖼️ Rendering', variant: 'default', showProgress: true },
  composing: { label: '📝 Composing', variant: 'default', showProgress: true },
  done: { label: '✅ Done', variant: 'success', showProgress: false },
  failed: { label: '❌ Failed', variant: 'destructive', showProgress: false },
};

const IN_PROGRESS_STAGES = new Set([
  'transcribing',
  'ingesting',
  'planning',
  'rendering',
  'composing',
]);

function stageConfig(stage: string): StageConfig {
  return STAGE_CONFIG[stage] ?? STAGE_CONFIG.pending!;
}

function progressPercent(p?: StageProgress | null): number {
  if (!p || !p.total || p.total <= 0) return 0;
  return Math.min(100, Math.round((p.current / p.total) * 100));
}

function progressLabel(p?: StageProgress | null): string {
  if (!p) return '';
  if (p.detail) return p.detail;
  if (p.total > 0) return `${p.current} / ${p.total}`;
  return '';
}

// ---------------------------------------------------------------------------
// Chapter card
// ---------------------------------------------------------------------------

function ChapterBoardCard({
  chapter,
  onReview,
  onRetry,
}: {
  chapter: BoardChapter;
  onReview: (chapterId: string) => void;
  onRetry: (chapterId: string) => void;
}): JSX.Element {
  const cfg = stageConfig(chapter.stage);
  const pct = progressPercent(chapter.stageProgress);
  const pLabel = progressLabel(chapter.stageProgress);
  const isInProgress = IN_PROGRESS_STAGES.has(chapter.stage);
  const canReview = chapter.stage === 'ready_for_review' || chapter.stage === 'done';
  const isFailed = chapter.stage === 'failed';

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant={cfg.variant}>{cfg.label}</Badge>
          <span className="text-xs text-muted-foreground font-medium">
            #{chapter.index}
          </span>
        </div>
        <CardTitle className="text-base">{chapter.title}</CardTitle>
        <CardDescription>
          Chapter {chapter.index}
          {chapter.description ? ` · ${chapter.description}` : ''}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {/* Progress bar for in-progress stages */}
        {cfg.showProgress && (
          <div className="flex flex-col gap-1">
            <Progress value={pct} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{pLabel || (isInProgress ? 'Working…' : '')}</span>
              {chapter.stageProgress && chapter.stageProgress.total > 0 && (
                <span>{pct}%</span>
              )}
            </div>
          </div>
        )}

        {/* Action button */}
        <div className="mt-auto pt-2">
          {canReview && (
            <Button className="w-full" size="sm" onClick={() => onReview(chapter.id)}>
              Review
            </Button>
          )}
          {isFailed && (
            <Button className="w-full" size="sm" variant="default" onClick={() => onRetry(chapter.id)}>
              Retry
            </Button>
          )}
          {isInProgress && (
            <Button className="w-full" size="sm" variant="outline" disabled>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Wait
            </Button>
          )}
          {chapter.stage === 'pending' && (
            <Button className="w-full" size="sm" variant="outline" disabled>
              Pending
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main board
// ---------------------------------------------------------------------------

export function ChapterBoard({ projectId, onReview }: ChapterBoardProps): JSX.Element {
  const [chapters, setChapters] = useState<BoardChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [adding, setAdding] = useState(false);
  const [uploadChapter, setUploadChapter] = useState<{ id: string; title: string } | null>(null);
  const [batchUploading, setBatchUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [libraryChapters, setLibraryChapters] = useState<LibraryChapter[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const refreshChapters = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/chapters`);
      if (res.ok) {
        const data = await res.json();
        setChapters(data as BoardChapter[]);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshChapters();
  }, [refreshChapters]);

  // Poll every 3s while any chapter is in-progress
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      await refreshChapters();
      if (cancelled) return;
      const stillWorking = chaptersRef.current.some((c) => IN_PROGRESS_STAGES.has(c.stage));
      if (!stillWorking && interval) {
        clearInterval(interval);
        interval = undefined;
      }
    };
    // Start polling if any chapter is currently in-progress
    if (chaptersRef.current.some((c) => IN_PROGRESS_STAGES.has(c.stage))) {
      interval = setInterval(poll, 3000);
    }
    return () => { cancelled = true; clearInterval(interval); };
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

  const onBatchUpload = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setBatchUploading(true);
    try {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      const res = await fetch(`/api/projects/${projectId}/chapters/upload-batch`, {
        method: 'POST',
        body: form,
      });
      if (res.ok) {
        await refreshChapters();
      }
    } catch {
      /* ignore */
    } finally {
      setBatchUploading(false);
    }
  };

  const openImportDialog = async () => {
    setImportOpen(true);
    setLibraryLoading(true);
    try {
      const res = await fetch('/api/library/chapters');
      if (res.ok) {
        const data = await res.json();
        // Filter out chapters from this project
        const filtered = (data.chapters as LibraryChapter[]).filter(
          (c) => c.projectId !== projectId,
        );
        setLibraryChapters(filtered);
      }
    } catch {
      /* ignore */
    } finally {
      setLibraryLoading(false);
    }
  };

  const onImportChapter = async (sourceChapterId: string) => {
    setImporting(sourceChapterId);
    try {
      const res = await fetch(`/api/projects/${projectId}/import-chapter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceChapterId }),
      });
      if (res.ok) {
        setImportOpen(false);
        await refreshChapters();
      }
    } catch {
      /* ignore */
    } finally {
      setImporting(null);
    }
  };

  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (batchUploading) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void onBatchUpload(e.dataTransfer.files);
    }
  };

  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const onDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const onRetry = async (chapterId: string) => {
    try {
      await fetch(`/api/chapters/${chapterId}/retry`, { method: 'POST' });
      await refreshChapters();
    } catch {
      /* ignore */
    }
  };

  const onUpload = (chapterId: string) => {
    const ch = chapters.find((c) => c.id === chapterId);
    setUploadChapter({ id: chapterId, title: ch?.title ?? 'Chapter' });
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
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={openImportDialog}>
            <Library className="h-3.5 w-3.5 mr-1.5" />
            Import from Library
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Chapter
          </Button>
        </div>
      </div>

      {/* Batch drag-and-drop upload zone */}
      <Card
        className={cn(
          'border-dashed transition-colors cursor-pointer',
          dragActive && 'border-primary/60 bg-primary/5',
          batchUploading && 'opacity-60 pointer-events-none',
        )}
        onClick={() => fileInputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <CardContent className="py-8 flex flex-col items-center justify-center gap-2 text-center">
          {batchUploading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Uploading and starting transcription…</p>
            </>
          ) : (
            <>
              <Upload className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm font-medium">
                <span className="mr-1">📁</span>Drop audio files here or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                .m4b, .mp3, .m4a, .wav, .flac — one chapter per file
              </p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="audio/*,.m4b,.mp3,.m4a,.wav,.flac"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void onBatchUpload(e.target.files);
              }
              e.target.value = '';
            }}
          />
        </CardContent>
      </Card>

      {/* Chapter cards grid */}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {chapters.map((chapter) => (
            <ChapterBoardCard
              key={chapter.id}
              chapter={chapter}
              onReview={onReview}
              onRetry={onRetry}
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

      {/* Upload modal for individual pending chapters */}
      {uploadChapter && (
        <ChapterUploadModal
          open={true}
          onOpenChange={(open) => { if (!open) setUploadChapter(null); }}
          chapterId={uploadChapter.id}
          chapterTitle={uploadChapter.title}
          onUploaded={refreshChapters}
        />
      )}

      {/* Import from library dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Import Chapter from Library</DialogTitle>
            <DialogDescription>
              Import a chapter from another project — copies audio, transcript, KB (characters, world bible, story sections), and plans (pages, panels). No re-transcription needed. Render results are not copied.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto py-2">
            {libraryLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : libraryChapters.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                No chapters available from other projects.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {libraryChapters.map((ch) => (
                  <div
                    key={ch.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{ch.title}</span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {ch.projectName}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{ch.sectionCount} sections</span>
                        <span>{ch.pageCount} pages</span>
                        <span>{ch.panelCount} panels</span>
                        {ch.renderedPanelCount > 0 && (
                          <span>{ch.renderedPanelCount} rendered</span>
                        )}
                        {ch.durationSec && (
                          <span>{Math.round(ch.durationSec / 60)}min</span>
                        )}
                        <Badge
                          variant={ch.stage === 'ready_for_review' || ch.stage === 'done' ? 'success' : 'warning'}
                          className="text-xs"
                        >
                          {ch.stage}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => onImportChapter(ch.id)}
                      disabled={importing !== null}
                    >
                      {importing === ch.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        'Import'
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
