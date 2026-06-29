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
  { value: "gptimage", label: "GPT Image" },
  { value: "gptimage-large", label: "GPT Image Large" },
  { value: "gpt-image-2", label: "GPT Image 2" },
  { value: "nanobanana-pro", label: "NanoBanana Pro" },
  { value: "nanobanana2", label: "NanoBanana 2" },
  { value: "seedream5", label: "Seedream 5" },
  { value: "seedream-pro", label: "Seedream Pro" },
  { value: "kontext", label: "Kontext" },
  { value: "zimage", label: "Z Image" },
  { value: "z-image-turbo", label: "Z Image Turbo" },
  { value: "klein", label: "Klein" },
  { value: "nova-canvas", label: "Nova Canvas" },
  { value: "qwen-image", label: "Qwen Image" },
  { value: "grok-imagine", label: "Grok Imagine" },
] as const;

const POLLINATIONS_PROVIDERS = [
  { value: "pollinations-paid", label: "Pollinations Paid" },
  { value: "pollinations-free", label: "Pollinations Free" },
] as const;

const LLM_PROVIDERS = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "pollinations", label: "Pollinations" },
  { value: "openai", label: "OpenAI" },
] as const;

const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openrouter: [
    { value: "mistralai/mistral-nemo", label: "Mistral Nemo" },
    { value: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout" },
  ],
  pollinations: [
    { value: "openai", label: "GPT-5.4 Nano" },
    { value: "openai-fast", label: "GPT-5 Nano" },
    { value: "deepseek", label: "DeepSeek V4 Flash" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  ],
};
interface CanvasTabProps {
  projectId: string;
}

export function CanvasTab({ projectId }: CanvasTabProps): JSX.Element {
  const {
    pages,
    loading,
    error,
    refresh,
    addPage,
    updatePanel,
    updatePanelBbox,
    updatePanelImage,
    updateLettering,
  } = useCanvasData(projectId);
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

  // Image model + provider selection (persisted to project in DB)
  const [selectedModel, setSelectedModel] = useState<string>("z-image-turbo");
  const [selectedProvider, setSelectedProvider] = useState<string>("pollinations-paid");
  useEffect(() => {
    let cancelled = false;
    const fetchModel = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/detail`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          const model = data.detail?.project?.renderModel;
          const provider = data.detail?.project?.renderProvider;
          if (model) setSelectedModel(model);
          if (provider) setSelectedProvider(provider);
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
  // LLM provider + model selection (persisted to project in DB, used for story planning)
  const [selectedLlmProvider, setSelectedLlmProvider] = useState<string>("");
  const [selectedLlmModel, setSelectedLlmModel] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    const fetchLlmConfig = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/detail`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          const llmProvider = data.detail?.project?.llmProvider;
          const llmModel = data.detail?.project?.llmModel;
          if (llmProvider) setSelectedLlmProvider(llmProvider);
          if (llmModel) setSelectedLlmModel(llmModel);
        }
      } catch {
        /* ignore */
      }
    };
    void fetchLlmConfig();
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const handleLlmProviderChange = useCallback(
    (provider: string) => {
      setSelectedLlmProvider(provider);
      const models = LLM_MODELS[provider];
      if (models && models.length > 0) {
        setSelectedLlmModel(models[0]?.value ?? "");
      }
      void fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llmProvider: provider, llmModel: models?.[0]?.value ?? "" }),
      });
    },
    [projectId],
  );
  const handleLlmModelChange = useCallback(
    (model: string) => {
      setSelectedLlmModel(model);
      void fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llmModel: model }),
      });
    },
    [projectId],
  );
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
  const handleProviderChange = useCallback(
    (provider: string) => {
      setSelectedProvider(provider);
      void fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renderProvider: provider }),
      });
    },
    [projectId],
  );
  // Per-panel rendering state (shared by handleRegenerate and handlePanelRender)
  const [renderingPanelIds, setRenderingPanelIds] = useState<Set<string>>(new Set());

  // Regenerate handler (synchronous — render API returns when done)
  const handleRegenerate = useCallback(
    async (panelId: string) => {
      setRenderingPanelIds((prev) => new Set(prev).add(panelId));
      try {
        const res = await fetch(`/api/panels/${panelId}/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: selectedModel, provider: selectedProvider }),
        });
        if (!res.ok) return;
        const data = await res.json();
        // Optimistically update the panel image with cache-busting.
        if (data.imageUrl) {
          updatePanelImage(panelId, `${data.imageUrl}?v=${Date.now()}`);
        }
      } catch {
        /* ignore */
      } finally {
        setRenderingPanelIds((prev) => {
          const next = new Set(prev);
          next.delete(panelId);
          return next;
        });
      }
    },
    [selectedModel, selectedProvider, updatePanelImage],
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

  // ── Export panel ──
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportType, setExportType] = useState<"mp4" | "cbz">("mp4");
  const [chapterExports, setChapterExports] = useState<
    { id: string; type: string; downloadUrl: string; sizeBytes: number; durationSec: number; slides: number; createdAt: string }[]
  >([]);

  // Load existing exports when export panel opens or chapter changes
  const loadExports = useCallback(async (chapterId: string) => {
    try {
      const res = await fetch(`/api/chapters/${chapterId}/exports`);
      if (res.ok) {
        const data = await res.json();
        setChapterExports(data.exports ?? []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (showExport && selectedChapterId) {
      void loadExports(selectedChapterId);
    }
  }, [showExport, selectedChapterId, loadExports]);

  const handleExport = useCallback(async () => {
    if (!selectedChapterId) return;
    setExporting(true);
    try {
      const endpoint = exportType === "mp4" ? "export-motion" : "export-cbz";
      const res = await fetch(`/api/chapters/${selectedChapterId}/${endpoint}`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        alert(err.error ?? "Export failed");
        return;
      }
      const data = await res.json();
      // Refresh exports list
      await loadExports(selectedChapterId);
      // Auto-download the new file
      const url = data.mp4Url ?? data.cbzUrl;
      if (url) window.open(url, "_blank");
    } catch (e) {
      alert("Export failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
    }
  }, [selectedChapterId, exportType, loadExports]);

  // Add blank page
  const handleAddPage = useCallback(async () => {
    await addPage(selectedChapterId ?? undefined);
  }, [addPage, selectedChapterId]);

  // Per-panel render handler (used by canvas Render buttons + Render All)
  const handlePanelRender = useCallback(
    async (panelId: string) => {
      setRenderingPanelIds((prev) => new Set(prev).add(panelId));
      try {
        const res = await fetch(`/api/panels/${panelId}/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: selectedModel, provider: selectedProvider }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error("panel render failed", body);
          return;
        }
        const data = await res.json();
        // Optimistically update the panel image with cache-busting.
        if (data.imageUrl) {
          updatePanelImage(panelId, `${data.imageUrl}?v=${Date.now()}`);
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
    [selectedModel, selectedProvider, updatePanelImage],
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
      for (let i = 0; i < unrenderedPanels.length; i++) {
        await handlePanelRender(unrenderedPanels[i]!.id);
        // Delay between renders to avoid Pollinations 429 rate limit.
        if (i < unrenderedPanels.length - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
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

          {/* Provider selector (paid = bills balance, free = rate-limited) */}
          <select
            value={selectedProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            title="Image generation provider / endpoint"
          >
            {POLLINATIONS_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>

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

          <div className="h-5 w-px bg-border" />

          {/* LLM provider selector (for story planning) */}
          <select
            value={selectedLlmProvider}
            onChange={(e) => handleLlmProviderChange(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            title="LLM provider for story planning"
          >
            {LLM_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>

          {/* LLM model selector */}
          <select
            value={selectedLlmModel}
            onChange={(e) => handleLlmModelChange(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            title="LLM model for story planning"
          >
            {(LLM_MODELS[selectedLlmProvider] ?? []).map((m) => (
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
            onClick={() => setShowExport((v) => !v)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              showExport
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            🎬 Export
          </button>
        </div>
      </div>
      {/* ── Export panel (slides in from right) ── */}
      {showExport && (
        <div className="pointer-events-auto absolute right-4 top-36 z-20 w-80 rounded-lg border bg-background/95 p-4 shadow-lg backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Motion Export</h3>
            <button
              onClick={() => setShowExport(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
          {!selectedChapterId ? (
            <p className="text-xs text-muted-foreground">
              Select a chapter first to export.
            </p>
          ) : (
            <>
              {/* Format toggle */}
              <div className="mb-3 flex gap-1 rounded-md border p-0.5">
                <button
                  onClick={() => setExportType("mp4")}
                  className={cn(
                    "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                    exportType === "mp4" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  🎬 MP4
                </button>
                <button
                  onClick={() => setExportType("cbz")}
                  className={cn(
                    "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                    exportType === "cbz" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  📖 CBZ
                </button>
              </div>

              <button
                onClick={handleExport}
                disabled={exporting}
                className="mb-3 w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {exporting
                  ? exportType === "mp4"
                    ? "Rendering MP4... (this takes a while)"
                    : "Creating CBZ..."
                  : exportType === "mp4"
                    ? "🎬 Generate Motion Comic MP4"
                    : "📖 Generate CBZ (Comic Book ZIP)"}
              </button>
              <p className="mb-3 text-xs text-muted-foreground">
                {exportType === "mp4"
                  ? "Ken-burns slideshow of panel images synced to the chapter's original audio."
                  : "ZIP of panel images with dialogue bubbles, named in reading order. Opens in comic book readers."}
              </p>
              {chapterExports.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground">
                    Previous exports ({chapterExports.length})
                  </h4>
                  {chapterExports.map((exp) => (
                    <div
                      key={exp.id}
                      className="flex items-center justify-between rounded-md border p-2 text-xs"
                    >
                      <div className="flex-1 overflow-hidden">
                        <div className="font-medium">
                          {exp.type === "mp4" ? "🎬" : "📖"}{" "}
                          {exp.type === "mp4" ? `${exp.durationSec.toFixed(0)}s` : `${exp.slides} panels`} ·{" "}
                          {(exp.sizeBytes / 1024 / 1024).toFixed(1)} MB
                        </div>
                        <div className="text-muted-foreground">
                          {new Date(exp.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <a
                        href={exp.downloadUrl}
                        download
                        className="ml-2 rounded-md bg-muted px-2 py-1 text-xs font-medium hover:bg-muted/80"
                      >
                        ⬇
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

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
          projectId={projectId}
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
