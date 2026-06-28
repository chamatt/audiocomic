import { useCallback, useEffect, useState } from 'react';
import type { PanelSpec, PageSpec, LetteringBox } from '@audiocomic/domain';

export interface CanvasPage extends PageSpec {
  panels: PanelSpec[];
  compositeUrl?: string;
  lettering: LetteringBox[];
  panelImages: Record<string, string>;
}

export interface CanvasData {
  pages: CanvasPage[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updatePanel: (panelId: string, patch: Partial<PanelSpec>) => void;
  updatePanelBbox: (panelId: string, bbox: { x: number; y: number; w: number; h: number }) => void;
  updateLettering: (pageId: string, boxes: LetteringBox[]) => void;
}

export function useCanvasData(projectId: string): CanvasData {
  const [pages, setPages] = useState<CanvasPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/projects/${projectId}/pages`);
      if (!res.ok) throw new Error(`Failed to fetch pages: ${res.status}`);
      const data = (await res.json()) as { pages: CanvasPage[] };
      setPages(data.pages ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updatePanel = useCallback((panelId: string, patch: Partial<PanelSpec>) => {
    setPages((prev) =>
      prev.map((page) => ({
        ...page,
        panels: page.panels.map((p) =>
          p.id === panelId ? { ...p, ...patch } : p,
        ),
      })),
    );
  }, []);

  const updatePanelBbox = useCallback(
    (panelId: string, bbox: { x: number; y: number; w: number; h: number }) => {
      setPages((prev) =>
        prev.map((page) => ({
          ...page,
          panels: page.panels.map((p) =>
            p.id === panelId ? { ...p, bbox } : p,
          ),
        })),
      );
    },
    [],
  );

  const updateLettering = useCallback((pageId: string, boxes: LetteringBox[]) => {
    setPages((prev) =>
      prev.map((page) =>
        page.id === pageId ? { ...page, lettering: boxes } : page,
      ),
    );
  }, []);

  return {
    pages,
    loading,
    error,
    refresh,
    updatePanel,
    updatePanelBbox,
    updateLettering,
  };
}
