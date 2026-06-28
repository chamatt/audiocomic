'use client';

import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type JSX } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PanelSpec, BoundingBox } from '@audiocomic/domain';
import { PanelBlock } from './PanelBlock';
import { BubbleOverlay } from './BubbleOverlay';
import { useCanvasStore } from '@/stores/canvas-store';
import type { CanvasPageData } from './types';

const PAGE_WIDTH = 800;
const PAGE_HEIGHT = 1131; // A4-ish ratio for comic page

export interface PageNodeData {
  page: CanvasPageData;
  onBboxChange: (panelId: string, bbox: BoundingBox) => void;
  onBubbleChange: (pageId: string, boxId: string, patch: Partial<BoundingBox>) => void;
}

export function PageNode({ data, selected }: NodeProps): JSX.Element {
  const nodeData = data as unknown as PageNodeData;
  const { page, onBboxChange, onBubbleChange } = nodeData;
  const { selectedPanelId, selectPage, mode } = useCanvasStore();
  const containerRef = useRef<HTMLDivElement>(null);

  const handleBackgroundClick = useCallback(() => {
    selectPage(page.id);
  }, [page.id, selectPage]);

  return (
    <div
      ref={containerRef}
      className={`relative bg-background shadow-2xl transition-shadow ${
        selected ? 'ring-2 ring-primary' : ''
      }`}
      style={{
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        backgroundImage: page.compositeUrl
          ? `url(${page.compositeUrl})`
          : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
      onClick={handleBackgroundClick}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      {/* Panels overlay (only show if no composite image, or always for editing) */}
      {!page.compositeUrl && (
        <div className="absolute inset-0">
          {page.panels.map((panel: PanelSpec) => (
            <PanelBlock
              key={panel.id}
              panel={panel}
              pageWidth={PAGE_WIDTH}
              pageHeight={PAGE_HEIGHT}
              imageUrl={page.panelImages[panel.id]}
              isSelected={selectedPanelId === panel.id}
              onBboxChange={onBboxChange}
            />
          ))}
        </div>
      )}

      {/* When composite exists, still show panel outlines for editing */}
      {page.compositeUrl && mode !== 'bubble' && (
        <div className="absolute inset-0">
          {page.panels.map((panel: PanelSpec) => (
            <PanelBlock
              key={panel.id}
              panel={panel}
              pageWidth={PAGE_WIDTH}
              pageHeight={PAGE_HEIGHT}
              imageUrl={page.panelImages[panel.id]}
              isSelected={selectedPanelId === panel.id}
              onBboxChange={onBboxChange}
            />
          ))}
        </div>
      )}

      {/* Bubble overlay */}
      {mode === 'bubble' && (
        <BubbleOverlay
          page={page}
          pageWidth={PAGE_WIDTH}
          pageHeight={PAGE_HEIGHT}
          onBubbleChange={onBubbleChange}
        />
      )}

      {/* Page number badge */}
      <div className="absolute -top-7 left-0 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
        Page {page.index + 1}
      </div>

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

// Suppress unused import warning — Position is used in Handle
void Position;
