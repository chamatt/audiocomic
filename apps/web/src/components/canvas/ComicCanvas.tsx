"use client";

import { useCallback, useEffect, useRef, type JSX } from "react";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch";
import type { BoundingBox } from "@audiocomic/domain";
import { ComicPage } from "./ComicPage";
import { useCanvasStore } from "@/stores/canvas-store";
import type { CanvasPageData } from "./types";

interface ComicCanvasProps {
  pages: CanvasPageData[];
  onPanelBboxChange: (panelId: string, bbox: BoundingBox) => void;
  onBubbleChange: (pageId: string, boxId: string, patch: Partial<BoundingBox>) => void;
  onBubbleTextChange: (pageId: string, boxId: string, text: string) => void;
  onBubbleDelete: (pageId: string, boxId: string) => void;
  onBubbleAdd: (pageId: string, bbox: BoundingBox, panelId?: string) => void;
  onPanelRender?: (panelId: string) => void;
  renderingPanelIds?: Set<string>;
}

// Page geometry on the board (px in world space). Comic page ratio ≈ 1 : 1.41.
const PAGE_WIDTH = 700;
const PAGE_HEIGHT = 990;
const PAGE_GAP = 80;
const MAX_COLS = 4;

const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

/** A purpose-built infinite pan/zoom board for comic pages. Replaces ReactFlow
 *  (which is meant for node/edge graphs). Pages are laid out in a wrapping grid
 *  and rendered as plain DOM, so all existing panel/bubble editing keeps working
 *  — panels stop pointer propagation, so dragging them never pans the board. */
export function ComicCanvas({
  pages,
  onPanelBboxChange,
  onBubbleChange,
  onBubbleTextChange,
  onBubbleDelete,
  onBubbleAdd,
  onPanelRender,
  renderingPanelIds,
}: ComicCanvasProps): JSX.Element {
  const { selectPanel, selectPage, setZoom, selectedPageId } = useCanvasStore();
  const apiRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const didInitialFit = useRef(false);

  const cols = Math.min(MAX_COLS, Math.max(1, pages.length));

  const fitToView = useCallback(() => {
    apiRef.current?.zoomToElement("comic-board", undefined, 400);
  }, []);

  // Fit the whole board into view once pages first arrive.
  useEffect(() => {
    if (didInitialFit.current || pages.length === 0) return;
    didInitialFit.current = true;
    // Wait a frame so the board has measured dimensions.
    const id = requestAnimationFrame(() => fitToView());
    return () => cancelAnimationFrame(id);
  }, [pages.length, fitToView]);

  // Center on the selected page when it changes.
  useEffect(() => {
    if (!selectedPageId) return;
    apiRef.current?.zoomToElement(`comic-page-${selectedPageId}`, 0.6, 400);
  }, [selectedPageId]);

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only deselect when the empty board background itself is clicked.
      if (e.target === e.currentTarget) {
        selectPanel(null);
        selectPage(null);
      }
    },
    [selectPanel, selectPage],
  );

  if (pages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-lg font-medium">No pages yet</p>
          <p className="text-sm">Run the pipeline to generate comic pages.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="comic-canvas relative h-full w-full overflow-hidden bg-muted/30">
      <TransformWrapper
        ref={apiRef}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        initialScale={0.5}
        centerOnInit
        limitToBounds={false}
        wheel={{ step: 0.08 }}
        doubleClick={{ disabled: true }}
        panning={{ velocityDisabled: true }}
        onTransform={(_ref, state) => setZoom(state.scale)}
      >
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={{ width: "fit-content", height: "fit-content" }}
        >
          <div
            id="comic-board"
            onClick={handleBackgroundClick}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, ${PAGE_WIDTH}px)`,
              gap: PAGE_GAP,
              padding: PAGE_GAP,
            }}
          >
            {pages.map((page) => (
              <ComicPage
                key={page.id}
                page={page}
                width={PAGE_WIDTH}
                height={PAGE_HEIGHT}
                selected={selectedPageId === page.id}
                onBboxChange={onPanelBboxChange}
                onBubbleChange={onBubbleChange}
                onBubbleTextChange={onBubbleTextChange}
                onBubbleDelete={onBubbleDelete}
                onBubbleAdd={onBubbleAdd}
                onRender={onPanelRender}
                renderingPanelIds={renderingPanelIds}
              />
            ))}
          </div>
        </TransformComponent>
      </TransformWrapper>

      {/* Zoom controls */}
      <div className="pointer-events-auto absolute bottom-4 left-4 z-20 flex flex-col gap-1 rounded-lg border bg-background/95 p-1 shadow-md backdrop-blur">
        <ZoomButton label="Zoom in" onClick={() => apiRef.current?.zoomIn()}>
          +
        </ZoomButton>
        <ZoomButton label="Zoom out" onClick={() => apiRef.current?.zoomOut()}>
          −
        </ZoomButton>
        <ZoomButton label="Fit to view" onClick={fitToView}>
          ⤢
        </ZoomButton>
      </div>
    </div>
  );
}

interface ZoomButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

function ZoomButton({ label, onClick, children }: ZoomButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
