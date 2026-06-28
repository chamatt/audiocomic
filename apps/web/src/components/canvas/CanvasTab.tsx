"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { PanelSpec, BoundingBox, LetteringBox } from "@audiocomic/domain";
import { ComicCanvas } from "./ComicCanvas";
import { PanelEditor } from "./PanelEditor";
import { CanvasToolbar } from "./CanvasToolbar";
import { PageThumbnailBar } from "./PageThumbnailBar";
import { useCanvasStore } from "@/stores/canvas-store";
import { useCanvasData } from "@/lib/canvas/use-canvas-data";
import { throttle } from "@/lib/canvas/throttle";
import type { CanvasPageData } from "./types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KnowledgePanel } from "./KnowledgePanel";

interface CanvasTabProps {
  projectId: string;
}

export function CanvasTab({ projectId }: CanvasTabProps): JSX.Element {
  const { pages, loading, error, refresh, addPage, updatePanel, updatePanelBbox, updateLettering } =
    useCanvasData(projectId);
  const { selectedPanelId, selectedPageId, selectPage, selectedChapterId, selectChapter } =
    useCanvasStore();

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

  // Regenerate handler
  const handleRegenerate = useCallback(
    async (panelId: string) => {
      try {
        const res = await fetch(`/api/panels/${panelId}/regenerate`, { method: "POST" });
        if (!res.ok) return;
        const { jobId } = (await res.json()) as { jobId: string };
        // Poll for job completion every 2s (max 120s)
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const jobRes = await fetch(`/api/jobs/${jobId}`);
          if (!jobRes.ok) break;
          const job = (await jobRes.json()) as { state: string };
          if (job.state === "completed" || job.state === "done") {
            await refresh();
            break;
          }
          if (job.state === "failed") break;
        }
      } catch {
        /* ignore */
      }
    },
    [refresh],
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
        const res = await fetch(`/api/panels/${panelId}/regenerate`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error("panel render failed", body);
          return;
        }
        const { jobId } = (await res.json()) as { jobId: string };
        // Poll for job completion every 2s (max 120s)
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const jobRes = await fetch(`/api/jobs/${jobId}`);
          if (!jobRes.ok) break;
          const job = (await jobRes.json()) as { state: string };
          if (job.state === "completed" || job.state === "done") {
            await refresh();
            break;
          }
          if (job.state === "failed") break;
        }
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
    [refresh],
  );

  // The selected chapter's stage (for render button visibility)
  const selectedChapterStage = useMemo(() => {
    if (!selectedChapterId) return null;
    const ch = chapters.find((c) => c.id === selectedChapterId);
    return ch?.stage ?? null;
  }, [chapters, selectedChapterId]);

  // Knowledge panel toggle
  const [showKnowledge, setShowKnowledge] = useState(false);

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
    <div className="flex h-full flex-col">
      <CanvasToolbar
        pageCount={filteredPages.length}
        currentPageIndex={currentPageIndex}
        onPageNavigate={handlePageNavigate}
        onAddPage={handleAddPage}
        onExport={handleExport}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
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
        </div>

        <PanelEditor
          panel={selectedPanel}
          panelImageUrl={selectedPanelImageUrl}
          onPatch={handlePanelPatch}
          onRegenerate={handleRegenerate}
        />

        {showKnowledge && (
          <div className="w-72 border-l overflow-hidden">
            <KnowledgePanel projectId={projectId} />
          </div>
        )}
      </div>

      {/* Chapter selector + page thumbnails */}
      <div className="border-t bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b overflow-x-auto">
          <span className="text-xs text-muted-foreground font-medium shrink-0">Chapter:</span>
          {chapters.map((ch) => (
            <Button
              key={ch.id}
              size="sm"
              variant={selectedChapterId === ch.id ? "default" : "outline"}
              className={cn("h-7 px-2.5 text-xs shrink-0")}
              onClick={() => selectChapter(ch.id)}
            >
              {ch.index}. {ch.title}
            </Button>
          ))}
          <Button
            size="sm"
            variant={selectedChapterId === null ? "default" : "outline"}
            className={cn("h-7 px-2.5 text-xs shrink-0")}
            onClick={() => selectChapter(null)}
          >
            All
          </Button>
          <div className="flex-1" />
          {selectedChapterStage === "ready_for_review" && (
            <span className="text-xs text-muted-foreground shrink-0">
              Click Render on any panel →
            </span>
          )}
          <Button
            size="sm"
            variant={showKnowledge ? "default" : "outline"}
            className="h-7 shrink-0"
            onClick={() => setShowKnowledge(!showKnowledge)}
          >
            📖 KB
          </Button>
          <span className="text-xs text-muted-foreground shrink-0">
            {filteredPages.length} page{filteredPages.length !== 1 ? "s" : ""}
          </span>
        </div>
        <PageThumbnailBar pages={filteredPages} onReorder={handlePageReorder} />
      </div>
    </div>
  );
}
