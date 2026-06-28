import { create } from 'zustand';

export type CanvasMode = 'select' | 'move' | 'bubble';

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

  // Actions
  selectPanel: (panelId: string | null) => void;
  selectPage: (pageId: string | null) => void;
  selectBubble: (bubbleId: string | null) => void;
  selectChapter: (id: string | null) => void;
  setMode: (mode: CanvasMode) => void;
  setZoom: (zoom: number) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  selectedPanelId: null,
  selectedPageId: null,
  selectedBubbleId: null,
  selectedChapterId: null,
  mode: 'select',
  zoom: 1,

  selectPanel: (panelId) =>
    set((s) => ({
      selectedPanelId: panelId,
      selectedBubbleId: panelId === null ? null : s.selectedBubbleId,
    })),

  selectPage: (pageId) => set({ selectedPageId: pageId }),
  selectBubble: (bubbleId) => set({ selectedBubbleId: bubbleId }),
  selectChapter: (id) => set({ selectedChapterId: id }),
  setMode: (mode) => set({ mode }),
  setZoom: (zoom) => set({ zoom }),
}));
