'use client';

import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type JSX } from 'react';
import type { PanelSpec, BoundingBox } from '@audiocomic/domain';
import { useCanvasStore } from '@/stores/canvas-store';

interface PanelBlockProps {
  panel: PanelSpec;
  pageWidth: number;
  pageHeight: number;
  imageUrl?: string;
  isSelected: boolean;
  onBboxChange: (panelId: string, bbox: BoundingBox) => void;
}

type DragState =
  | { kind: 'move'; startX: number; startY: number; origBbox: BoundingBox }
  | { kind: 'resize'; corner: 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; origBbox: BoundingBox }
  | null;

const MIN_W = 0.05;
const MIN_H = 0.05;

export function PanelBlock({
  panel,
  pageWidth,
  pageHeight,
  imageUrl,
  isSelected,
  onBboxChange,
}: PanelBlockProps): JSX.Element {
  const { selectPanel, mode } = useCanvasStore();
  const dragState = useRef<DragState>(null);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${panel.bbox.x * 100}%`,
    top: `${panel.bbox.y * 100}%`,
    width: `${panel.bbox.w * 100}%`,
    height: `${panel.bbox.h * 100}%`,
    zIndex: panel.zIndex,
  };

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, kind: 'move' | 'resize', corner?: 'nw' | 'ne' | 'sw' | 'se') => {
      if (mode === 'bubble') return;
      e.stopPropagation();
      e.preventDefault();
      selectPanel(panel.id);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      dragState.current =
        kind === 'move'
          ? { kind: 'move', startX: e.clientX, startY: e.clientY, origBbox: panel.bbox }
          : { kind: 'resize', corner: corner!, startX: e.clientX, startY: e.clientY, origBbox: panel.bbox };
    },
    [mode, panel.id, panel.bbox, selectPanel],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const ds = dragState.current;
      if (!ds) return;

      const dx = (e.clientX - ds.startX) / pageWidth;
      const dy = (e.clientY - ds.startY) / pageHeight;
      const orig = ds.origBbox;

      if (ds.kind === 'move') {
        const x = Math.max(0, Math.min(1 - orig.w, orig.x + dx));
        const y = Math.max(0, Math.min(1 - orig.h, orig.y + dy));
        onBboxChange(panel.id, { ...orig, x, y });
      } else {
        let { x, y, w, h } = orig;
        if (ds.corner === 'nw') {
          x = Math.max(0, Math.min(orig.x + orig.w - MIN_W, orig.x + dx));
          y = Math.max(0, Math.min(orig.y + orig.h - MIN_H, orig.y + dy));
          w = orig.x + orig.w - x;
          h = orig.y + orig.h - y;
        } else if (ds.corner === 'ne') {
          y = Math.max(0, Math.min(orig.y + orig.h - MIN_H, orig.y + dy));
          w = Math.max(MIN_W, Math.min(1 - orig.x, orig.w + dx));
          h = orig.y + orig.h - y;
        } else if (ds.corner === 'sw') {
          x = Math.max(0, Math.min(orig.x + orig.w - MIN_W, orig.x + dx));
          w = orig.x + orig.w - x;
          h = Math.max(MIN_H, Math.min(1 - orig.y, orig.h + dy));
        } else {
          // se
          w = Math.max(MIN_W, Math.min(1 - orig.x, orig.w + dx));
          h = Math.max(MIN_H, Math.min(1 - orig.y, orig.h + dy));
        }
        onBboxChange(panel.id, { x, y, w, h });
      }
    },
    [pageWidth, pageHeight, panel.id, onBboxChange],
  );

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragState.current = null;
    }
  }, []);

  return (
    <div
      style={style}
      className={`group relative cursor-pointer overflow-hidden rounded-sm border-2 transition-colors ${
        isSelected
          ? 'border-primary ring-2 ring-primary/40'
          : 'border-white/20 hover:border-white/50'
      }`}
      onPointerDown={(e) => handlePointerDown(e, 'move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={(e) => {
        e.stopPropagation();
        selectPanel(panel.id);
      }}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={panel.description}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted/40 p-2 text-center text-xs text-muted-foreground">
          {panel.description || `Panel ${panel.index + 1}`}
        </div>
      )}

      {/* Panel index badge */}
      <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {panel.index + 1}
      </div>

      {/* QA status badge */}
      {panel.qaStatus === 'passed' && (
        <div className="pointer-events-none absolute right-1 top-1 rounded bg-green-600/80 px-1 py-0.5 text-[10px] text-white">
          ✓
        </div>
      )}
      {panel.qaStatus === 'failed' && (
        <div className="pointer-events-none absolute right-1 top-1 rounded bg-red-600/80 px-1 py-0.5 text-[10px] text-white">
          ✗
        </div>
      )}

      {/* Resize handles (only in select mode and when selected) */}
      {isSelected && mode === 'select' && (
        <>
          <ResizeHandle corner="nw" onPointerDown={(e) => handlePointerDown(e, 'resize', 'nw')} />
          <ResizeHandle corner="ne" onPointerDown={(e) => handlePointerDown(e, 'resize', 'ne')} />
          <ResizeHandle corner="sw" onPointerDown={(e) => handlePointerDown(e, 'resize', 'sw')} />
          <ResizeHandle corner="se" onPointerDown={(e) => handlePointerDown(e, 'resize', 'se')} />
        </>
      )}
    </div>
  );
}

interface ResizeHandleProps {
  corner: 'nw' | 'ne' | 'sw' | 'se';
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

function ResizeHandle({ corner, onPointerDown }: ResizeHandleProps): JSX.Element {
  const positions: Record<string, string> = {
    nw: 'left-0 top-0 cursor-nw-resize',
    ne: 'right-0 top-0 cursor-ne-resize',
    sw: 'left-0 bottom-0 cursor-sw-resize',
    se: 'right-0 bottom-0 cursor-se-resize',
  };
  return (
    <div
      className={`absolute ${positions[corner]} z-10 h-3 w-3 rounded-sm border border-primary bg-primary`}
      onPointerDown={onPointerDown}
    />
  );
}
