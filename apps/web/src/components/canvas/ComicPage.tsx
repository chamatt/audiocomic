"use client";

import { useCallback, type JSX } from "react";
import type { PanelSpec, BoundingBox } from "@audiocomic/domain";
import { PanelBlock } from "./PanelBlock";
import { BubbleOverlay } from "./BubbleOverlay";
import { useCanvasStore } from "@/stores/canvas-store";
import type { CanvasPageData } from "./types";

export interface ComicPageProps {
  page: CanvasPageData;
  width: number;
  height: number;
  selected: boolean;
  onBboxChange: (panelId: string, bbox: BoundingBox) => void;
  onBubbleChange: (pageId: string, boxId: string, patch: Partial<BoundingBox>) => void;
  onBubbleTextChange: (pageId: string, boxId: string, text: string) => void;
  onBubbleDelete: (pageId: string, boxId: string) => void;
  onBubbleAdd: (pageId: string, bbox: BoundingBox, panelId?: string) => void;
  onRender?: (panelId: string) => void;
  renderingPanelIds?: Set<string>;
}

/** A single comic page rendered on the board. Pure DOM — the canvas owns
 *  positioning, pan and zoom, so this just lays panels/bubbles inside a fixed
 *  page rectangle (percentages keep everything resolution-independent). */
export function ComicPage({
  page,
  width,
  height,
  selected,
  onBboxChange,
  onBubbleChange,
  onBubbleTextChange,
  onBubbleDelete,
  onBubbleAdd,
  onRender,
  renderingPanelIds,
}: ComicPageProps): JSX.Element {
  const { selectedPanelId, selectPage, mode } = useCanvasStore();

  const handleBackgroundPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Don't start a canvas pan when interacting with a page.
      e.stopPropagation();
      selectPage(page.id);
    },
    [page.id, selectPage],
  );

  return (
    <div
      id={`comic-page-${page.id}`}
      className={`relative bg-background shadow-2xl transition-shadow ${
        selected ? "ring-2 ring-primary" : ""
      }`}
      style={{
        width,
        height,
        backgroundImage: page.compositeUrl ? `url(${page.compositeUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      onPointerDown={handleBackgroundPointerDown}
    >
      {/* Panels overlay — shown when there's no composite, or for editing
          when a composite exists and we're not placing bubbles. */}
      {(!page.compositeUrl || mode !== "bubble") && (
        <div className="absolute inset-0">
          {page.panels.map((panel: PanelSpec) => (
            <PanelBlock
              key={panel.id}
              panel={panel}
              pageWidth={width}
              pageHeight={height}
              imageUrl={page.panelImages[panel.id]}
              isSelected={selectedPanelId === panel.id}
              isRendering={renderingPanelIds?.has(panel.id)}
              onBboxChange={onBboxChange}
              onRender={page.compositeUrl ? undefined : onRender}
            />
          ))}
        </div>
      )}

      {/* Bubble overlay */}
      {mode === "bubble" && (
        <BubbleOverlay
          page={page}
          pageWidth={width}
          pageHeight={height}
          onBubbleChange={onBubbleChange}
          onBubbleTextChange={onBubbleTextChange}
          onBubbleDelete={onBubbleDelete}
          onBubbleAdd={onBubbleAdd}
        />
      )}

      {/* Page number badge */}
      <div className="absolute -top-7 left-0 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
        Page {page.index + 1}
      </div>
    </div>
  );
}
