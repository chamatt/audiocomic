"use client";

import { useState, useCallback, useRef, type JSX } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { StorySection, PanelSpec, StoryLevel } from "@audiocomic/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoryboardTabProps {
  sections: StorySection[];
  panels: PanelSpec[];
}

interface SectionNode {
  section: StorySection;
  children: SectionNode[];
}

// ---------------------------------------------------------------------------
// Level badge config
// ---------------------------------------------------------------------------

const LEVEL_LABEL: Record<StoryLevel, string> = {
  chapter: "Chapter",
  scene: "Scene",
  beat: "Beat",
};

const LEVEL_BADGE_CLASS: Record<StoryLevel, string> = {
  chapter: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  scene: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  beat: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

function buildTree(sections: StorySection[]): SectionNode[] {
  const byParent = new Map<string | undefined, StorySection[]>();
  for (const s of sections) {
    const list = byParent.get(s.parentId) ?? [];
    list.push(s);
    byParent.set(s.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.index - b.index);
  }
  const buildLevel = (parentId: string | undefined): SectionNode[] =>
    (byParent.get(parentId) ?? []).map((section) => ({
      section,
      children: buildLevel(section.id),
    }));
  // Roots are sections with no parentId — chapters.
  return buildLevel(undefined);
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

function formatTime(sec: number | undefined): string {
  if (sec === undefined || sec === null) return "--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Debounced inputs (inline, mirroring PanelEditor.tsx)
// ---------------------------------------------------------------------------

function DebouncedInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}): JSX.Element {
  const [local, setLocal] = useState(value);
  // setTimeout returns number in the browser/DOM lib this client runs under.
  const timer = useRef<number | undefined>(undefined);

  // Keep local in sync when the upstream value changes externally.
  const prevValue = useRef(value);
  if (prevValue.current !== value) {
    prevValue.current = value;
    setLocal(value);
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocal(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(v), 500);
  };

  return (
    <Input
      value={local}
      onChange={handleChange}
      placeholder={placeholder}
      className={className}
    />
  );
}

function DebouncedTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}): JSX.Element {
  const [local, setLocal] = useState(value);
  const timer = useRef<number | undefined>(undefined);

  // Keep local in sync when the upstream value changes externally.
  const prevValue = useRef(value);
  if (prevValue.current !== value) {
    prevValue.current = value;
    setLocal(value);
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setLocal(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(v), 500);
  };

  return (
    <Textarea
      value={local}
      onChange={handleChange}
      placeholder={placeholder}
      rows={rows}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// PATCH helper
// ---------------------------------------------------------------------------

function patchSection(id: string, patch: { title?: string; summary?: string }) {
  void fetch(`/api/sections/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

// ---------------------------------------------------------------------------
// Panel list under a beat
// ---------------------------------------------------------------------------

const QA_VARIANT: Record<PanelSpec["qaStatus"], string> = {
  pending: "bg-muted text-muted-foreground border-border",
  passed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  regenerate: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function PanelRow({ panel }: { panel: PanelSpec }): JSX.Element {
  const hasRender = Boolean(panel.renderResultId);
  const description =
    panel.description.length > 120
      ? `${panel.description.slice(0, 120)}…`
      : panel.description;
  return (
    <div className="flex items-start gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <Badge variant="outline" className="shrink-0 tabular-nums">
        #{panel.index}
      </Badge>
      <p className="flex-1 text-xs text-muted-foreground leading-relaxed">
        {description}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        {hasRender ? (
          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
            Rendered
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            No render
          </Badge>
        )}
        {panel.qaStatus && panel.qaStatus !== "pending" && (
          <Badge className={cn("capitalize", QA_VARIANT[panel.qaStatus])}>
            QA: {panel.qaStatus}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card (recursive)
// ---------------------------------------------------------------------------

function SectionCard({ node, panels }: { node: SectionNode; panels: PanelSpec[] }): JSX.Element {
  const { section, children } = node;
  const level = section.level;
  const [expanded, setExpanded] = useState(true);

  const beatPanels =
    level === "beat"
      ? panels
          .filter((p) => p.storySectionId === section.id)
          .sort((a, b) => a.index - b.index)
      : [];

  const hasChildren = children.length > 0;
  const hasPanels = beatPanels.length > 0;

  const onTitleChange = useCallback(
    (title: string) => patchSection(section.id, { title }),
    [section.id],
  );
  const onSummaryChange = useCallback(
    (summary: string) => patchSection(section.id, { summary }),
    [section.id],
  );

  return (
    <div className="flex flex-col gap-2">
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn("capitalize", LEVEL_BADGE_CLASS[level])}
            >
              {LEVEL_LABEL[level]}
            </Badge>
            {(hasChildren || hasPanels) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                onClick={() => setExpanded((e) => !e)}
              >
                {expanded ? "Collapse" : "Expand"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Title</span>
            <DebouncedInput
              value={section.title ?? ""}
              onChange={onTitleChange}
              placeholder={`${LEVEL_LABEL[level]} title`}
              className="h-8"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Summary</span>
            <DebouncedTextarea
              value={section.summary}
              onChange={onSummaryChange}
              placeholder={`${LEVEL_LABEL[level]} summary`}
              rows={3}
            />
          </div>

          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {section.emotionalTone && (
              <Badge variant="outline" className="capitalize">
                {section.emotionalTone}
              </Badge>
            )}
            {section.cameraHint && (
              <Badge variant="outline" className="capitalize">
                {section.cameraHint}
              </Badge>
            )}
            <span>
              {section.charactersPresent.length} character
              {section.charactersPresent.length === 1 ? "" : "s"}
            </span>
            <span>
              {formatTime(section.startSec)} – {formatTime(section.endSec)}
            </span>
            {section.objects.length > 0 && (
              <span>{section.objects.length} objects</span>
            )}
          </div>

          {/* Panels under a beat */}
          {hasPanels && expanded && (
            <>
              <Separator className="my-1" />
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Panels ({beatPanels.length})
                </span>
                {beatPanels.map((p) => (
                  <PanelRow key={p.id} panel={p} />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Children (scenes under chapter, beats under scene) */}
      {hasChildren && expanded && (
        <div className="ml-4 flex flex-col gap-2 border-l border-border/40 pl-3">
          {children.map((child) => (
            <SectionCard key={child.section.id} node={child} panels={panels} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function StoryboardTab({ sections, panels }: StoryboardTabProps): JSX.Element {
  if (sections.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storyboard</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No story plan yet. Run the plan_chapters pipeline step to generate a
            storyboard.
          </p>
        </CardContent>
      </Card>
    );
  }

  const tree = buildTree(sections);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold tracking-tight">Storyboard</h2>
          <p className="text-xs text-muted-foreground">
            Review and refine the structured story plan before rendering. Edits
            save automatically.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{sections.length} sections</span>
          <span>·</span>
          <span>{panels.length} panels</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {tree.map((node) => (
          <SectionCard key={node.section.id} node={node} panels={panels} />
        ))}
      </div>
    </div>
  );
}
