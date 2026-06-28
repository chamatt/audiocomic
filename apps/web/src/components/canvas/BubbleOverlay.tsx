'use client';

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type JSX } from 'react';
import type { BoundingBox, LetteringBox } from '@audiocomic/domain';
import { useCanvasStore } from '@/stores/canvas-store';
import type { CanvasPageData } from './types';

interface BubbleOverlayProps {
  page: CanvasPageData;
  pageWidth: number;
  pageHeight: number;
  onBubbleChange: (pageId: string, boxId: string, patch: Partial<BoundingBox>) => void;
  onBubbleTextChange: (pageId: string, boxId: string, text: string) => void;
  onBubbleDelete: (pageId: string, boxId: string) => void;
  onBubbleAdd: (pageId: string, bbox: BoundingBox, panelId?: string) => void;
}

interface BubbleDragState {
  boxId: string;
  startX: number;
  startY: number;
  origBbox: BoundingBox;
}

export function BubbleOverlay({
  page,
  pageWidth,
  pageHeight,
  onBubbleChange,
  onBubbleTextChange,
  onBubbleDelete,
  onBubbleAdd,
}: BubbleOverlayProps): JSX.Element {
  const { selectedBubbleId, selectBubble, selectPanel } = useCanvasStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const dragState = useRef<BubbleDragState | null>(null);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, box: LetteringBox) => {
      e.stopPropagation();
      e.preventDefault();
      selectBubble(box.id);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragState.current = {
        boxId: box.id,
        startX: e.clientX,
        startY: e.clientY,
        origBbox: box.bbox,
      };
    },
    [selectBubble],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const ds = dragState.current;
      if (!ds) return;
      const dx = (e.clientX - ds.startX) / pageWidth;
      const dy = (e.clientY - ds.startY) / pageHeight;
      const x = Math.max(0, Math.min(1 - ds.origBbox.w, ds.origBbox.x + dx));
      const y = Math.max(0, Math.min(1 - ds.origBbox.h, ds.origBbox.y + dy));
      onBubbleChange(page.id, ds.boxId, { x, y });
    },
    [page.id, pageWidth, pageHeight, onBubbleChange],
  );

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragState.current = null;
    }
  }, []);

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only add bubble if clicking the background (not a bubble)
      if (e.target !== e.currentTarget) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      // Default bubble size
      const bbox: BoundingBox = { x: Math.min(x, 0.7), y: Math.min(y, 0.85), w: 0.3, h: 0.15 };
      onBubbleAdd(page.id, bbox);
    },
    [page.id, onBubbleAdd],
  );

  return (
    <div className="absolute inset-0 cursor-crosshair" onClick={handleBackgroundClick}>
      {page.lettering.map((box) => (
        <Bubble
          key={box.id}
          box={box}
          isSelected={selectedBubbleId === box.id}
          isEditing={editingId === box.id}
          onPointerDown={(e) => handlePointerDown(e, box)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={() => setEditingId(box.id)}
          onTextChange={(text) => onBubbleTextChange(page.id, box.id, text)}
          onEditEnd={() => setEditingId(null)}
          onDelete={() => {
            onBubbleDelete(page.id, box.id);
            selectBubble(null);
          }}
        />
      ))}
    </div>
  );
}

interface BubbleProps {
  box: LetteringBox;
  isSelected: boolean;
  isEditing: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  onTextChange: (text: string) => void;
  onEditEnd: () => void;
  onDelete: () => void;
}

function Bubble({
  box,
  isSelected,
  isEditing,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDoubleClick,
  onTextChange,
  onEditEnd,
  onDelete,
}: BubbleProps): JSX.Element {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${box.bbox.x * 100}%`,
    top: `${box.bbox.y * 100}%`,
    width: `${box.bbox.w * 100}%`,
    minHeight: `${box.bbox.h * 100}%`,
  };

  const bubbleClass = getBubbleClass(box.type);

  return (
    <div
      style={style}
      className={`cursor-move select-none p-1 ${bubbleClass} ${
        isSelected ? 'ring-2 ring-primary' : ''
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onClick={(e) => e.stopPropagation()}
    >
      {isEditing ? (
        <textarea
          autoFocus
          defaultValue={box.text}
          onBlur={(e) => {
            onTextChange(e.target.value);
            onEditEnd();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onEditEnd();
            }
          }}
          className="w-full resize-none bg-transparent text-xs outline-none"
          style={{
            fontSize: box.fontSize ? `${box.fontSize}px` : undefined,
            fontFamily: box.fontFamily,
            color: box.color,
          }}
        />
      ) : (
        <span
          className="block text-xs"
          style={{
            fontSize: box.fontSize ? `${box.fontSize}px` : undefined,
            fontFamily: box.fontFamily,
            color: box.color,
          }}
        >
          {box.text || '(empty)'}
        </span>
      )}

      {isSelected && !isEditing && (
        <button
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function getBubbleClass(type: LetteringBox['type']): string {
  switch (type) {
    case 'speech':
      return 'rounded-2xl border-2 border-black bg-white text-black shadow-md';
    case 'thought':
      return 'rounded-full border-2 border-dashed border-black bg-white text-black';
    case 'narration':
      return 'border-2 border-black bg-yellow-100 text-black font-medium';
    case 'sfx':
      return 'border-2 border-red-600 bg-white text-red-600 font-bold text-base';
    case 'caption':
      return 'border border-white/50 bg-black/70 text-white';
    default:
      return 'rounded border border-black bg-white text-black';
  }
}
