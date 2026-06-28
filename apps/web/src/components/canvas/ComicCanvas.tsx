'use client';

import { useCallback, useMemo, type CSSProperties, type JSX } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { BoundingBox } from '@audiocomic/domain';
import { PageNode } from './PageNode';
import { useCanvasStore } from '@/stores/canvas-store';
import type { CanvasPageData } from './types';

interface ComicCanvasProps {
  pages: CanvasPageData[];
  onPanelBboxChange: (panelId: string, bbox: BoundingBox) => void;
  onBubbleChange: (pageId: string, boxId: string, patch: Partial<BoundingBox>) => void;
  onBubbleTextChange: (pageId: string, boxId: string, text: string) => void;
  onBubbleDelete: (pageId: string, boxId: string) => void;
  onBubbleAdd: (pageId: string, bbox: BoundingBox, panelId?: string) => void;
}

const PAGE_GAP = 100;
const PAGE_WIDTH = 800;

const nodeTypes: NodeTypes = {
  comicPage: PageNode,
};
function ComicCanvasInner({
  pages,
  onPanelBboxChange,
  onBubbleChange,
  onBubbleTextChange,
  onBubbleDelete,
  onBubbleAdd,
}: ComicCanvasProps): JSX.Element {
  const { selectPanel, selectPage, setZoom } = useCanvasStore();

  const nodes: Node[] = useMemo(
    () =>
      pages.map((page, i) => ({
        id: page.id,
        type: 'comicPage',
        position: { x: i * (PAGE_WIDTH + PAGE_GAP), y: 0 },
        data: {
          page,
          onBboxChange: onPanelBboxChange,
          onBubbleChange,
          onBubbleTextChange,
          onBubbleDelete,
          onBubbleAdd,
        },
        draggable: false,
      })),
    [pages, onPanelBboxChange, onBubbleChange, onBubbleTextChange, onBubbleDelete, onBubbleAdd],
  );

  const edges: Edge[] = useMemo(() => {
    if (pages.length < 2) return [];
    const result: Edge[] = [];
    for (let i = 0; i < pages.length - 1; i++) {
      const page = pages[i];
      const next = pages[i + 1];
      if (!page || !next) continue;
      result.push({
        id: `${page.id}-${next.id}`,
        source: page.id,
        target: next.id,
        type: 'smoothstep',
        style: { stroke: 'hsl(var(--muted-foreground))', opacity: 0.3 },
      });
    }
    return result;
  }, [pages]);

  const handlePaneClick = useCallback(() => {
    selectPanel(null);
    selectPage(null);
  }, [selectPanel, selectPage]);

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
    <div className="h-full w-full" style={{ '--xy-edge-stroke-default': 'transparent' } as CSSProperties}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onPaneClick={handlePaneClick}
        onMove={(_, viewport) => setZoom(viewport.zoom)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 0.5 }}
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--muted))" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={() => 'hsl(var(--muted))'}
          maskColor="rgba(0,0,0,0.7)"
          className="!bg-background !border"
        />
      </ReactFlow>
    </div>
  );
}

export function ComicCanvas(props: ComicCanvasProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <ComicCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

// Re-export types for convenience
export type { PanelSpec, LetteringBox } from '@audiocomic/domain';
