"use client";

import type { JSX } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCanvasStore, type CanvasMode } from "@/stores/canvas-store";
import { cn } from "@/lib/utils";

interface ToolDef {
  value: CanvasMode;
  label: string;
  icon: string;
  shortcut: string;
}

const TOOLS: ToolDef[] = [
  { value: "select", label: "Select & resize panels", icon: "↖", shortcut: "V" },
  { value: "move", label: "Pan the canvas", icon: "✥", shortcut: "M" },
  { value: "bubble", label: "Add & edit speech bubbles", icon: "💬", shortcut: "B" },
];

/** Vertical tool rail on the left edge of the canvas. Keeps mode switching out
 *  of the crowded top bar and pairs each tool with a keyboard shortcut. */
export function ToolRail(): JSX.Element {
  const { mode, setMode } = useCanvasStore();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="pointer-events-auto flex flex-col gap-1 rounded-lg border bg-background/95 p-1 shadow-md backdrop-blur">
        {TOOLS.map((tool) => (
          <Tooltip key={tool.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={tool.label}
                aria-pressed={mode === tool.value}
                onClick={() => setMode(tool.value)}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md text-base transition-colors",
                  mode === tool.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {tool.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>{tool.label}</span>
              <kbd className="rounded border bg-muted px-1 text-[10px] font-medium text-muted-foreground">
                {tool.shortcut}
              </kbd>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
