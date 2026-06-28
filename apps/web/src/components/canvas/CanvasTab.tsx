"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { PanelSpec, BoundingBox } from "@audiocomic/domain";
import { ComicCanvas } from "./ComicCanvas";
import { PanelEditor } from "./PanelEditor";

import { PageThumbnailBar } from "./PageThumbnailBar";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCanvasData } from "@/lib/canvas/use-canvas-data";
import { throttle } from "@/lib/canvas/throttle";
import type { CanvasPageData } from "./types";
import { cn } from "@/lib/utils";
import { KnowledgePanel } from "./KnowledgePanel";

const MODES = [
  { value: "select" as const, label: "Select", icon: "↖" },
  { value: "move" as const, label: "Move", icon: "✥" },
  { value: "bubble" as const, label: "Bubbles", icon: "💬" },
];

const POLLINATIONS_MODELS = [
  { value: "flux", label: "Flux" },
  { value: "turbo", label: "Turbo" },
  { value: "gptimage", label: "GPT Image" },
  { value: "sana", label: "Sana" },
  { value: "nanobanana-pro", label: "NanoBanana Pro" },
  { value: "seedream5", label: "Seedream 5" },
  { value: "kontext", label: "Kontext" },
] as const;

interface CanvasTabProps {
  projectId: string;
}

export function CanvasTab({ projectId }: CanvasTabProps): JSX.Element {
  const { pages, loading, error, refresh, addPage, updatePanel, updatePanelBbox, updateLettering } =
    useCanvasData(projectId);
  const {
    selectedPanelId,
    selectedPageId,
    selectPage,
    selectedChapterId,
    selectChapter,
    mode,
    setMode,
  } = useCanvasStore();

  // Chapter metadata for the selector bar (id + title + stage)
  interface ChapterMeta {
    id: string;
    index: number;
    title: string;
    stage: string;
  }
  const [chapters, setChapters] = useState<ChapterMeta[]>([]);
  useEffect(() => {
    let cancelled = false;
    const fetchChapters = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/chapters`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as ChapterMeta[];
          setChapters(data);
        }
      } catch {
        /* ignore */
      }
    };
    void fetchChapters();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Convert pages to canvas format
  const canvasPages: CanvasPageData[] = useMemo(
    () =>
      pages.map((p) => ({
        id: p.id,
        index: p.index,
        projectId: p.projectId,
        chapterId: p.chapterId,
        panelIds: p.panelIds,
        panelCount: p.panelCount,
        readingOrder: p.readingOrder,
        panels: p.panels,
        compositeUrl: p.compositeUrl,
        lettering: p.lettering,
        panelImages: p.panelImages,
      })),
    [pages],
  );

  // Filter pages by selected chapter (from store); null = show all
  const filteredPages = useMemo(() => {
    if (!selectedChapterId) return canvasPages;
    return canvasPages.filter((p) => p.chapterId === selectedChapterId);
  }, [canvasPages, selectedChapterId]);

  const selectedPanel = useMemo(() => {
    for (const page of pages) {
      const found = page.panels.find((p) => p.id === selectedPanelId);
      if (found) return found;
    }
    return null;
  }, [pages, selectedPanelId]);

  const selectedPanelImageUrl = useMemo(() => {
    if (!selectedPanelId) return undefined;
    for (const page of pages) {
      if (page.panelImages[selectedPanelId]) {
        return page.panelImages[selectedPanelId];
      }
    }
    return undefined;
  }, [pages, selectedPanelId]);

  const currentPageIndex = useMemo(() => {
    if (!selectedPageId) return 0;
    const idx = pages.findIndex((p) => p.id === selectedPageId);
    return idx >= 0 ? idx : 0;
  }, [pages, selectedPageId]);

  // Throttled API save for panel bbox (fires at most once per 150ms during drag)
  const savePanelBbox = useRef(
    throttle((panelId: string, bbox: BoundingBox) => {
      void fetch(`/api/panels/${panelId}/bbox`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bbox),
      });
    }, 150),
  ).current;

  // Panel bbox change handler — optimistic local + throttled API
  const handlePanelBboxChange = useCallback(
    (panelId: string, bbox: BoundingBox) => {
      updatePanelBbox(panelId, bbox);
      savePanelBbox(panelId, bbox);
    },
    [updatePanelBbox, savePanelBbox],
  );

  // Panel patch handler — optimistic + API
  const handlePanelPatch = useCallback(
    async (panelId: string, patch: Partial<PanelSpec>) => {
      updatePanel(panelId, patch);
      await fetch(`/api/panels/${panelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    },
    [updatePanel],
  );

  // Image model selection (persisted to project in DB)
  const [selectedModel, setSelectedModel] = useState<string>("gptimage");
  useEffect(() => {
    let cancelled = false;
    const fetchModel = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/detail`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          const model = data.detail?.project?.renderModel;
          if (model) setSelectedModel(model);
        }
      } catch {
        /* ignore */
      }
    };
    void fetchModel();
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const handleModelChange = useCallback(
    (model: string) => {
      setSelectedModel(model);
      void fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renderModel: model }),
      });
    },
    [projectId],
  );

  // Regenerate handler (synchronous — render API returns when done)
  const handleRegenerate = useCallback(
    async (panelId: string) => {
      try {
        const res = await fetch(`/api/panels/${panelId}/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: selectedModel }),
        });
        if (!res.ok) return;
        await refresh();
      } catch {
        /* ignore */
      }
    },
    [refresh, selectedModel],
  );

  // Throttled API save for bubble position (fires at most once per 150ms during drag)
  const saveBubblePosition = useRef(
    throttle((pageId: string, boxId: string, bbox: Partial<BoundingBox>) => {
      void fetch(`/api/lettering/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boxId, bbox }),
      });
    }, 150),
  ).current;

  // Bubble change handler — optimistic local + throttled API
  const handleBubbleChange = useCallback(
    (pageId: string, boxId: string, patch: Partial<BoundingBox>) => {
      const page = pages.find((p) => p.id === pageId);
      if (!page) return;
      const newBoxes = page.lettering.map((b) =>
        b.id === boxId ? { ...b, bbox: { ...b.bbox, ...patch } } : b,
      );
      updateLettering(pageId, newBoxes);
      saveBubblePosition(pageId, boxId, patch);
    },
    [pages, updateLettering, saveBubblePosition],
  );

  // Bubble text change handler
  const handleBubbleTextChange = useCallback(
    (pageId: string, boxId: string, text: string) => {
      const page = pages.find((p) => p.id === pageId);
      if (!page) return;
      const newBoxes = page.lettering.map((b) => (b.id === boxId ? { ...b, text } : b));
      updateLettering(pageId, newBoxes);
      void fetch(`/api/lettering/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boxId, text }),
      });
    },
    [pages, updateLettering],
  );

  // Bubble delete handler
  const handleBubbleDelete = useCallback(
    (pageId: string, boxId: string) => {
      const page = pages.find((p) => p.id === pageId);
      if (!page) return;
      const newBoxes = page.lettering.filter((b) => b.id !== boxId);
      updateLettering(pageId, newBoxes);
      void fetch(`/api/lettering/${pageId}?boxId=${boxId}`, {
        method: "DELETE",
      });
    },
    [pages, updateLettering],
  );

  // Bubble add handler
  const handleBubbleAdd = useCallback(
    (pageId: string, bbox: BoundingBox, panelId?: string) => {
      void fetch(`/api/pages/${pageId}/lettering`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "speech", text: "", bbox, panelId }),
      }).then(() => {
        void refresh();
      });
    },
    [refresh],
  );

  // Page reorder handler
  const handlePageReorder = useCallback(
    (newOrder: CanvasPageData[]) => {
      // Update indices and persist
      newOrder.forEach((page, i) => {
        if (page.index !== i) {
          void fetch(`/api/pages/${page.id}/reorder`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index: i }),
          });
        }
      });
      // Trigger refresh to get updated data
      void refresh();
    },
    [refresh],
  );

  // Page navigation
  const handlePageNavigate = useCallback(
    (direction: "prev" | "next") => {
      const targetIdx = direction === "prev" ? currentPageIndex - 1 : currentPageIndex + 1;
      if (targetIdx >= 0 && targetIdx < pages.length) {
        const target = pages[targetIdx];
        if (target) selectPage(target.id);
      }
    },
    [currentPageIndex, pages, selectPage],
  );

  // Export handler
  const handleExport = useCallback(
    (type: "pages" | "mp4") => {
      void fetch(`/api/projects/${projectId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
    },
    [projectId],
  );

  // Add blank page
  const handleAddPage = useCallback(async () => {
    await addPage(selectedChapterId ?? undefined);
  }, [addPage, selectedChapterId]);

  // Per-panel rendering state
  const [renderingPanelIds, setRenderingPanelIds] = useState<Set<string>>(new Set());
  const handlePanelRender = useCallback(
    async (panelId: string) => {
      setRenderingPanelIds((prev) => new Set(prev).add(panelId));
      try {
        const res = await fetch(`/api/panels/${panelId}/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: selectedModel }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error("panel render failed", body);
          return;
        }
        // Render is synchronous — refresh canvas to pick up the new image.
        await refresh();
      } catch (e) {
        console.error("panel render request failed", e);
      } finally {
        setRenderingPanelIds((prev) => {
          const next = new Set(prev);
          next.delete(panelId);
          return next;
        });
      }
    },
    [refresh, selectedModel],
  );

  // The selected chapter's stage (for render button visibility)
  const selectedChapterStage = useMemo(() => {
    if (!selectedChapterId) return null;
    const ch = chapters.find((c) => c.id === selectedChapterId);
    return ch?.stage ?? null;
  }, [chapters, selectedChapterId]);

  // Knowledge panel toggle
  const [showKnowledge, setShowKnowledge] = useState(false);

  // Render all unrendered panels in the current chapter sequentially.
  const [isRenderingAll, setIsRenderingAll] = useState(false);
  const handleRenderAll = useCallback(async () => {
    const chapterPages = pages.filter(
      (p) => !selectedChapterId || p.chapterId === selectedChapterId,
    );
    const unrenderedPanels = chapterPages.flatMap((p) => p.panels).filter((p) => !p.renderResultId);
    if (unrenderedPanels.length === 0) return;
    setIsRenderingAll(true);
    try {
      for (const panel of unrenderedPanels) {
        await handlePanelRender(panel.id);
      }
    } finally {
      setIsRenderingAll(false);
    }
  }, [pages, selectedChapterId, handlePanelRender]);
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading pages...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">Error: {error}</div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Canvas fills the entire viewport */}
      <ComicCanvas
        pages={filteredPages}
        onPanelBboxChange={handlePanelBboxChange}
        onBubbleChange={handleBubbleChange}
        onBubbleTextChange={handleBubbleTextChange}
        onBubbleDelete={handleBubbleDelete}
        onBubbleAdd={handleBubbleAdd}
        onPanelRender={handlePanelRender}
        renderingPanelIds={renderingPanelIds}
      />

      {/* ── Floating UI: top-center toolbar ── */}
      <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border bg-background/95 p-1.5 shadow-md backdrop-blur">
          {/* Mode toggle */}
          <div className="flex items-center rounded-md border">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium transition-colors",
                  mode === m.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <span className="mr-1">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-border" />

          {/* Page navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePageNavigate("prev")}
              disabled={currentPageIndex === 0}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              ←
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {currentPageIndex + 1}/{filteredPages.length}
            </span>
            <button
              onClick={() => handlePageNavigate("next")}
              disabled={currentPageIndex >= filteredPages.length - 1}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              →
            </button>
          </div>

          <div className="h-5 w-px bg-border" />

          <button
            onClick={handleAddPage}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            + Page
          </button>

          <div className="h-5 w-px bg-border" />

          {/* Model selector */}
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            title="Image generation model"
          >
            {POLLINATIONS_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          {selectedChapterStage === "ready_for_review" && (
            <button
              onClick={handleRenderAll}
              disabled={isRenderingAll || renderingPanelIds.size > 0}
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isRenderingAll ? "Rendering…" : "Render All"}
            </button>
          )}
        </div>
      </div>

      {/* ── Floating UI: top-left chapter selector ── */}
      <div className="pointer-events-none absolute left-4 top-20 z-20">
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-md backdrop-blur">
          <span className="px-2 text-xs font-medium text-muted-foreground">Chapter</span>
          {chapters.map((ch) => (
            <button
              key={ch.id}
              onClick={() => selectChapter(ch.id)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                selectedChapterId === ch.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {ch.index}
            </button>
          ))}
          <button
            onClick={() => selectChapter(null)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              selectedChapterId === null
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            All
          </button>
        </div>
      </div>

      {/* ── Floating UI: top-right actions ── */}
      <div className="pointer-events-none absolute right-4 top-20 z-20">
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-md backdrop-blur">
          <button
            onClick={() => setShowKnowledge(!showKnowledge)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              showKnowledge
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            📖 KB
          </button>
          <button
            onClick={() => handleExport("pages")}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            Export
          </button>
        </div>
      </div>

      {/* ── Floating UI: right PanelEditor (slides in/out) ── */}
      <div
        className={cn(
          "pointer-events-auto absolute right-0 top-16 z-30 h-[calc(100%-140px)] transition-transform duration-200",
          selectedPanel ? "translate-x-0" : "translate-x-full",
        )}
      >
        <PanelEditor
          panel={selectedPanel}
          panelImageUrl={selectedPanelImageUrl}
          onPatch={handlePanelPatch}
          onRegenerate={handleRegenerate}
        />
      </div>

      {/* ── Floating UI: bottom-center page thumbnails ── */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
        <div className="pointer-events-auto rounded-lg border bg-background/95 p-1.5 shadow-md backdrop-blur">
          <PageThumbnailBar pages={filteredPages} onReorder={handlePageReorder} />
        </div>
      </div>

      {/* ── Floating UI: Knowledge panel (right side, below toolbar) ── */}
      {showKnowledge && (
        <div className="pointer-events-auto absolute right-4 top-36 z-20 w-72 rounded-lg border bg-background/95 shadow-md backdrop-blur">
          <div className="flex items-center justify-between border-b p-2">
            <span className="text-xs font-medium">Knowledge Base</span>
            <button
              onClick={() => setShowKnowledge(false)}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              ✕
            </button>
          </div>
          <div className="max-h-[400px] overflow-auto">
            <KnowledgePanel projectId={projectId} />
          </div>
        </div>
      )}
    </div>
  );
}
