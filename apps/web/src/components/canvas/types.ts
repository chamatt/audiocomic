import type { PanelSpec, LetteringBox } from '@audiocomic/domain';

export interface CanvasPageData {
  id: string;
  index: number;
  projectId: string;
  panelIds: string[];
  panelCount: number;
  readingOrder: string[];
  panels: PanelSpec[];
  compositeUrl?: string;
  lettering: LetteringBox[];
  panelImages: Record<string, string>;
}
