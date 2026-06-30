"use client";

import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type JSX,
  type ReactNode,
} from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { cn } from "@/lib/utils";

interface RightDockProps {
  title: string;
  /** Optional control rendered on the right of the header (e.g. a badge). */
  headerExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/** A single, resizable right-hand dock. Everything that used to be its own
 *  overlapping floating panel (panel editor, export, knowledge) now renders
 *  inside this one container, so they can never collide. Drag the left edge to
 *  resize; the width is shared across all dock contents via the store. */
export function RightDock({ title, headerExtra, onClose, children }: RightDockProps): JSX.Element {
  const { dockWidth, setDockWidth } = useCanvasStore();
  const resizing = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      resizing.current = { startX: e.clientX, startWidth: dockWidth };
    },
    [dockWidth],
  );

  const handleResizeMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const r = resizing.current;
      if (!r) return;
      // Dragging left (smaller clientX) widens the dock.
      setDockWidth(r.startWidth + (r.startX - e.clientX));
    },
    [setDockWidth],
  );

  const handleResizeEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (resizing.current) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      resizing.current = null;
    }
  }, []);

  return (
    <div
      className="pointer-events-auto absolute right-3 top-16 z-30 flex h-[calc(100%-150px)] flex-col overflow-hidden rounded-lg border bg-background/95 shadow-lg backdrop-blur"
      style={{ width: dockWidth }}
    >
      {/* Resize handle on the left edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        className={cn(
          "group absolute left-0 top-0 z-10 flex h-full w-2 cursor-ew-resize items-center justify-center",
        )}
      >
        <div className="h-10 w-1 rounded-full bg-border transition-colors group-hover:bg-primary" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5 pl-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {headerExtra}
        </div>
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
