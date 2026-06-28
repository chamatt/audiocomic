"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  Project,
  PageSpec,
  PanelSpec,
  StorySection,
  CharacterProfile,
  WorldBible,
  ExportBundle,
  JobRecord,
} from "@audiocomic/domain";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pause,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  SkipForward,
} from "lucide-react";
import { CanvasTab } from "@/components/canvas/CanvasTab";
import { ChapterBoard } from "@/components/ChapterBoard";
import { useCanvasStore } from "@/stores/canvas-store";

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

const STATUS_CONFIG: Record<
  string,
  { variant: "default" | "destructive" | "success" | "warning" | "outline"; icon: typeof Clock }
> = {
  pending: { variant: "outline", icon: Clock },
  running: { variant: "warning", icon: Loader2 },
  paused: { variant: "default", icon: Pause },
  completed: { variant: "success", icon: CheckCircle2 },
  failed: { variant: "destructive", icon: AlertCircle },
  skipped: { variant: "outline", icon: SkipForward },
  stale: { variant: "warning", icon: RefreshCw },
  idle: { variant: "outline", icon: Clock },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending!;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1.5">
      <Icon className={cn("h-3 w-3", status === "running" && "animate-spin")} />
      {status}
    </Badge>
  );
}

interface WikiPageEntry {
  id: string;
  type: string;
  title: string;
  content: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Knowledge tab
// ---------------------------------------------------------------------------

const WIKI_TYPE_LABELS: Record<string, string> = {
  character: "Characters",
  location: "Locations",
  object: "Objects",
  concept: "Concepts",
  event: "Events",
  timeline: "Timeline",
};

const WIKI_TYPE_ORDER = ["character", "location", "object", "concept", "event", "timeline"];

function KnowledgeTab({
  projectId,
  characters,
  worldBible,
}: {
  projectId: string;
  characters: CharacterProfile[];
  worldBible: WorldBible | null;
}) {
  const [wikiPages, setWikiPages] = useState<WikiPageEntry[]>([]);
  const [wikiLoading, setWikiLoading] = useState(true);
  const [wikiError, setWikiError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/projects/${projectId}/knowledge`);
      if (cancelled) return;
      if (res.ok) {
        const data = await res.json();
        setWikiPages(data.wikiPages ?? []);
      } else {
        setWikiError("Failed to load knowledge base");
      }
      setWikiLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Group wiki pages by type
  const grouped = wikiPages.reduce<Record<string, WikiPageEntry[]>>((acc, page) => {
    const type = page.type in WIKI_TYPE_LABELS ? page.type : "other";
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
          <CardDescription>
            {characters.length} character{characters.length === 1 ? "" : "s"} in the bible
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {characters.length === 0 ? (
            <p className="text-sm text-muted-foreground">No characters defined yet.</p>
          ) : (
            characters.map((c) => (
              <div key={c.id} className="flex flex-col gap-1 pb-3 border-b last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{c.name}</span>
                  <Badge variant="outline" className="capitalize text-xs">
                    {c.role}
                  </Badge>
                </div>
                {c.aliases.length > 0 && (
                  <p className="text-xs text-muted-foreground">Aliases: {c.aliases.join(", ")}</p>
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
                <span className="text-muted-foreground">{worldBible.genre.join(", ")}</span>
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
            {wikiLoading
              ? "Loading…"
              : `${wikiPages.length} page${wikiPages.length === 1 ? "" : "s"} from the knowledge base`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {wikiError && (
            <p className="text-sm text-destructive">Failed to load wiki: {wikiError}</p>
          )}
          {!wikiLoading && wikiPages.length === 0 && !wikiError && (
            <p className="text-sm text-muted-foreground">
              No wiki pages yet. They appear after chapter knowledge is ingested.
            </p>
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
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {page.content}
                  </p>
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
  const [activeTab, setActiveTab] = useState<string>("canvas");
  const project = detail.project;
  const { selectChapter } = useCanvasStore();

  // --- Data refresh ---
  const refreshDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/detail`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data.detail);
      }
    } catch {
      /* ignore */
    }
  }, [projectId]);

  // --- Lazy actor init ---
  useEffect(() => {
    fetch(`/api/projects/${projectId}/setup`, { method: "POST" }).catch(() => {
      /* non-fatal */
    });
  }, [projectId]);

  // --- Chapter review handler: switch to canvas tab + set selected chapter ---
  const handleChapterReview = useCallback(
    (chapterId: string) => {
      selectChapter(chapterId);
      setActiveTab("canvas");
    },
    [selectChapter],
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            <StatusBadge status={project.status} />
          </div>
          <p className="text-sm text-muted-foreground">{project.description ?? "No description"}</p>
          <p className="text-xs text-muted-foreground capitalize">{project.modality}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="canvas">Canvas</TabsTrigger>
          <TabsTrigger value="chapters">Chapters</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Chapters tab */}
        <TabsContent value="chapters">
          <ChapterBoard projectId={projectId} onReview={handleChapterReview} />
        </TabsContent>

        {/* Canvas tab */}
        <TabsContent value="canvas" className="h-[calc(100vh-220px)]">
          <CanvasTab projectId={projectId} />
        </TabsContent>

        {/* Knowledge tab */}
        <TabsContent value="knowledge">
          <KnowledgeTab
            projectId={projectId}
            characters={detail.characters}
            worldBible={detail.worldBible}
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
                  <Input value={project.description ?? ""} readOnly />
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
                <CardDescription>
                  LLM, transcription, and image rendering configuration
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label>LLM Model</Label>
                    <Input value={project.providerSettings?.llmModel ?? "default"} readOnly />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Image Model</Label>
                    <Input value={project.providerSettings?.imageModel ?? "default"} readOnly />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Renderer</Label>
                    <Input
                      value={project.providerSettings?.rendererBackend ?? "default"}
                      readOnly
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Transcription</Label>
                    <Input
                      value={project.providerSettings?.transcriptionProvider ?? "default"}
                      readOnly
                    />
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
