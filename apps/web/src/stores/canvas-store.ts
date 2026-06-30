import { create } from "zustand";

export type CanvasMode = "select" | "move" | "bubble";

/** Auxiliary content shown in the right dock (the panel editor takes priority
 *  when a panel is selected). */
export type RightPanel = "export" | "knowledge" | null;

export const MIN_DOCK_WIDTH = 300;
export const MAX_DOCK_WIDTH = 640;
const DEFAULT_DOCK_WIDTH = 380;

export interface CanvasState {
  // Selection
  selectedPanelId: string | null;
  selectedPageId: string | null;
  selectedBubbleId: string | null;

  // Selected chapter (drives canvas page filtering + board→canvas handoff)
  selectedChapterId: string | null;

  // Mode
  mode: CanvasMode;

  // Zoom
  zoom: number;

  // Right dock — a single dock holds the panel editor OR an auxiliary panel
  // (export / knowledge). Only one is ever visible, so they never overlap.
  rightPanel: RightPanel;
  dockWidth: number;

  // Bottom thumbnail strip
  thumbnailsCollapsed: boolean;

  // Actions
  selectPanel: (panelId: string | null) => void;
  selectPage: (pageId: string | null) => void;
  selectBubble: (bubbleId: string | null) => void;
  selectChapter: (id: string | null) => void;
  setMode: (mode: CanvasMode) => void;
  setZoom: (zoom: number) => void;
  setRightPanel: (panel: RightPanel) => void;
  setDockWidth: (width: number) => void;
  toggleThumbnails: () => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  selectedPanelId: null,
  selectedPageId: null,
  selectedBubbleId: null,
  selectedChapterId: null,
  mode: "select",
  zoom: 1,
  rightPanel: null,
  dockWidth: DEFAULT_DOCK_WIDTH,
  thumbnailsCollapsed: false,

  // Selecting a panel opens the editor in the dock — close any auxiliary panel
  // so the dock only ever shows one thing.
  selectPanel: (panelId) =>
    set((s) => ({
      selectedPanelId: panelId,
      selectedBubbleId: panelId === null ? null : s.selectedBubbleId,
      rightPanel: panelId === null ? s.rightPanel : null,
    })),

  selectPage: (pageId) => set({ selectedPageId: pageId }),
  selectBubble: (bubbleId) => set({ selectedBubbleId: bubbleId }),
  selectChapter: (id) => set({ selectedChapterId: id }),
  setMode: (mode) => set({ mode }),
  setZoom: (zoom) => set({ zoom }),

  // Opening an auxiliary panel clears the panel selection (and editor) so the
  // dock has a single occupant.
  setRightPanel: (panel) =>
    set((s) => ({
      rightPanel: panel,
      selectedPanelId: panel === null ? s.selectedPanelId : null,
    })),

  setDockWidth: (width) =>
    set({ dockWidth: Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, width)) }),

  toggleThumbnails: () => set((s) => ({ thumbnailsCollapsed: !s.thumbnailsCollapsed })),
}));
