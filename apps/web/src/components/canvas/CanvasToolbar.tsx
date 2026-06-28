'use client';

import type { JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCanvasStore, type CanvasMode } from '@/stores/canvas-store';

interface CanvasToolbarProps {
  pageCount: number;
  currentPageIndex: number;
  onPageNavigate: (direction: 'prev' | 'next') => void;
  onAddPage?: () => void;
  onExport?: (type: 'pages' | 'pdf' | 'mp4') => void;
}

const MODES: { value: CanvasMode; label: string; icon: string }[] = [
  { value: 'select', label: 'Select', icon: '↖' },
  { value: 'move', label: 'Move', icon: '✥' },
  { value: 'bubble', label: 'Bubbles', icon: '💬' },
];

export function CanvasToolbar({
  pageCount,
  currentPageIndex,
  onPageNavigate,
  onAddPage,
  onExport,
}: CanvasToolbarProps): JSX.Element {
  const { mode, setMode } = useCanvasStore();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-2 border-b bg-background px-4 py-2">
        {/* Mode toggle */}
        <div className="flex items-center rounded-md border">
          {MODES.map((m) => (
            <Tooltip key={m.value}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={mode === m.value ? 'default' : 'ghost'}
                  className="rounded-none"
                  onClick={() => setMode(m.value)}
                >
                  <span className="mr-1">{m.icon}</span>
                  {m.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{m.label} mode</TooltipContent>
            </Tooltip>
          ))}
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={currentPageIndex <= 0}
            onClick={() => onPageNavigate('prev')}
          >
            ←
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {pageCount > 0 ? `${currentPageIndex + 1} / ${pageCount}` : 'No pages'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={currentPageIndex >= pageCount - 1}
            onClick={() => onPageNavigate('next')}
          >
            →
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Add page */}
        {onAddPage && (
          <Button size="sm" variant="outline" onClick={onAddPage}>
            + Page
          </Button>
        )}

        <div className="flex-1" />

        {/* Export */}
        {onExport && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => onExport('pages')}>
              Export ZIP
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onExport('pdf')}>
              Export PDF
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onExport('mp4')}>
              Export MP4
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
