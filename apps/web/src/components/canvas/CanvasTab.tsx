'use client';

import { useCallback, useMemo, type JSX } from 'react';
import type { PanelSpec, BoundingBox, LetteringBox } from '@audiocomic/domain';
import { ComicCanvas } from './ComicCanvas';
import { PanelEditor } from './PanelEditor';
import { CanvasToolbar } from './CanvasToolbar';
import { PageThumbnailBar } from './PageThumbnailBar';
import { useCanvasStore } from '@/stores/canvas-store';
import { useCanvasData } from '@/lib/canvas/use-canvas-data';
import type { CanvasPageData } from './types';

interface CanvasTabProps {
  projectId: string;
}

export function CanvasTab({ projectId }: CanvasTabProps): JSX.Element {
  const { pages, loading, error, refresh, updatePanel, updatePanelBbox, updateLettering } =
    useCanvasData(projectId);
  const { selectedPanelId, selectedPageId, selectPage } = useCanvasStore();

  // Convert pages to canvas format
  const canvasPages: CanvasPageData[] = useMemo(
    () =>
      pages.map((p) => ({
        id: p.id,
        index: p.index,
        projectId: p.projectId,
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

  // Panel bbox change handler — optimistic + API
  const handlePanelBboxChange = useCallback(
    (panelId: string, bbox: BoundingBox) => {
      updatePanelBbox(panelId, bbox);
      void fetch(`/api/panels/${panelId}/bbox`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bbox),
      });
    },
    [updatePanelBbox],
  );

  // Panel patch handler — optimistic + API
  const handlePanelPatch = useCallback(
    async (panelId: string, patch: Partial<PanelSpec>) => {
      updatePanel(panelId, patch);
      await fetch(`/api/panels/${panelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    },
    [updatePanel],
  );

  // Regenerate handler
  const handleRegenerate = useCallback(async (panelId: string) => {
    await fetch(`/api/panels/${panelId}/regenerate`, { method: 'POST' });
  }, []);

  // Bubble change handler
  const handleBubbleChange = useCallback(
    (pageId: string, boxId: string, patch: Partial<BoundingBox>) => {
      // Find the page and update the box locally
      const page = pages.find((p) => p.id === pageId);
      if (!page) return;
      const newBoxes = page.lettering.map((b) =>
        b.id === boxId ? { ...b, bbox: { ...b.bbox, ...patch } } : b,
      );
      updateLettering(pageId, newBoxes);

      // Save to API — PATCH the lettering
      void fetch(`/api/lettering/${pageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxId, bbox: { ...patch } }),
      });
    },
    [pages, updateLettering],
  );

  // Page reorder handler
  const handlePageReorder = useCallback(
    (newOrder: CanvasPageData[]) => {
      // Update indices and persist
      newOrder.forEach((page, i) => {
        if (page.index !== i) {
          void fetch(`/api/pages/${page.id}/reorder`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
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
    (direction: 'prev' | 'next') => {
      const targetIdx =
        direction === 'prev' ? currentPageIndex - 1 : currentPageIndex + 1;
      if (targetIdx >= 0 && targetIdx < pages.length) {
        const target = pages[targetIdx];
        if (target) selectPage(target.id);
      }
    },
    [currentPageIndex, pages, selectPage],
  );

  // Export handler
  const handleExport = useCallback(
    (type: 'pages' | 'pdf' | 'mp4') => {
      void fetch(`/api/projects/${projectId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
    },
    [projectId],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading pages...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <CanvasToolbar
        pageCount={pages.length}
        currentPageIndex={currentPageIndex}
        onPageNavigate={handlePageNavigate}
        onExport={handleExport}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <ComicCanvas
            pages={canvasPages}
            onPanelBboxChange={handlePanelBboxChange}
            onBubbleChange={handleBubbleChange}
          />
        </div>

        <PanelEditor
          panel={selectedPanel}
          panelImageUrl={selectedPanelImageUrl}
          onPatch={handlePanelPatch}
          onRegenerate={handleRegenerate}
        />
      </div>

      <PageThumbnailBar pages={canvasPages} onReorder={handlePageReorder} />
    </div>
  );
}

