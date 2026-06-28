"use client";

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PanelSpec, CameraFraming } from "@audiocomic/domain";

const CAMERA_FRAMINGS: CameraFraming[] = [
  "wide",
  "medium",
  "close-up",
  "extreme-close-up",
  "overhead",
  "low-angle",
  "pov",
  "establishing",
];

const QA_STATUSES = ["pending", "passed", "failed", "regenerate"] as const;

interface PanelEditorProps {
  panel: PanelSpec | null;
  panelImageUrl?: string;
  onPatch: (panelId: string, patch: Partial<PanelSpec>) => Promise<void>;
  onRegenerate: (panelId: string) => Promise<void>;
}

export function PanelEditor({
  panel,
  panelImageUrl,
  onPatch,
  onRegenerate,
}: PanelEditorProps): JSX.Element | null {
  const [regenerating, setRegenerating] = useState(false);

  if (!panel) {
    return null;
  }

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await onRegenerate(panel.id);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="flex h-full w-[360px] flex-col rounded-lg border bg-background/95 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Panel {panel.index + 1}</h3>
          <QaBadge status={panel.qaStatus} />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 p-4">
          {/* Preview */}
          {panelImageUrl && (
            <div className="overflow-hidden rounded-md border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={panelImageUrl} alt={panel.description} className="w-full" />
            </div>
          )}

          {/* Description */}
          <FieldSection title="Description">
            <DebouncedTextarea
              key={`desc-${panel.id}`}
              value={panel.description}
              onChange={(v) => onPatch(panel.id, { description: v })}
              placeholder="What does this panel show?"
              rows={3}
            />
          </FieldSection>

          {/* Camera Framing */}
          <FieldSection title="Camera Framing">
            <Select
              value={panel.cameraFraming ?? ""}
              onValueChange={(v) => onPatch(panel.id, { cameraFraming: v as CameraFraming })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select framing" />
              </SelectTrigger>
              <SelectContent>
                {CAMERA_FRAMINGS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldSection>

          <Separator />

          {/* Render Prompt */}
          <FieldSection title="Render Prompt">
            <DebouncedTextarea
              key={`prompt-${panel.id}`}
              value={panel.renderPrompt ?? ""}
              onChange={(v) => onPatch(panel.id, { renderPrompt: v })}
              placeholder="Prompt sent to image generator"
              rows={4}
              className="font-mono text-xs"
            />
          </FieldSection>

          <FieldSection title="Negative Prompt">
            <DebouncedTextarea
              key={`neg-${panel.id}`}
              value={panel.renderNegativePrompt ?? ""}
              onChange={(v) => onPatch(panel.id, { renderNegativePrompt: v })}
              placeholder="Things to avoid"
              rows={2}
              className="font-mono text-xs"
            />
          </FieldSection>

          <div className="grid grid-cols-2 gap-3">
            <FieldSection title="Seed">
              <DebouncedInput
                key={`seed-${panel.id}`}
                type="number"
                value={panel.seed?.toString() ?? ""}
                onChange={(v) => onPatch(panel.id, { seed: v ? parseInt(v, 10) : undefined })}
              />
            </FieldSection>
            <FieldSection title="QA Status">
              <Select
                value={panel.qaStatus}
                onValueChange={(v) => onPatch(panel.id, { qaStatus: v as PanelSpec["qaStatus"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QA_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldSection>
          </div>

          <Button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="w-full"
            variant="default"
          >
            {regenerating ? "Regenerating..." : "Regenerate Panel"}
          </Button>

          <Separator />

          {/* Characters */}
          <CharacterEditor panel={panel} onPatch={onPatch} />

          <Separator />

          {/* Dialogue */}
          <DialogueEditor panel={panel} onPatch={onPatch} />
        </div>
      </ScrollArea>
    </div>
  );
}

// --- Sub-components ---

function FieldSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </Label>
      {children}
    </div>
  );
}

function QaBadge({ status }: { status: PanelSpec["qaStatus"] }): JSX.Element {
  const variants: Record<string, "default" | "outline" | "destructive" | "warning"> = {
    pending: "outline",
    passed: "default",
    failed: "destructive",
    regenerate: "warning",
  };
  return <Badge variant={variants[status] ?? "outline"}>{status}</Badge>;
}

// Debounced textarea that calls onChange after user stops typing
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
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(v), 600);
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

function DebouncedInput({
  value,
  onChange,
  type = "text",
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
}): JSX.Element {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(v), 600);
  };

  return <Input type={type} value={local} onChange={handleChange} />;
}

// --- Character Editor ---

function CharacterEditor({
  panel,
  onPatch,
}: {
  panel: PanelSpec;
  onPatch: (panelId: string, patch: Partial<PanelSpec>) => Promise<void>;
}): JSX.Element {
  const characters = panel.characters;

  const updateChar = (index: number, patch: Partial<PanelSpec["characters"][number]>) => {
    const newChars = characters.map((c, i) => (i === index ? { ...c, ...patch } : c));
    void onPatch(panel.id, { characters: newChars });
  };

  const removeChar = (index: number) => {
    const newChars = characters.filter((_, i) => i !== index);
    void onPatch(panel.id, { characters: newChars });
  };

  const addChar = () => {
    void onPatch(panel.id, {
      characters: [...characters, { characterId: crypto.randomUUID(), position: "center" }],
    });
  };

  return (
    <FieldSection title="Characters">
      <div className="space-y-3">
        {characters.map((char, i) => (
          <div key={i} className="space-y-2 rounded-md border p-2">
            <div className="flex items-center justify-between">
              <Input
                value={char.characterId}
                onChange={(e) => updateChar(i, { characterId: e.target.value })}
                placeholder="Character ID"
                className="h-7 text-xs"
              />
              <Button size="sm" variant="ghost" onClick={() => removeChar(i)} className="h-7 px-2">
                ×
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={char.pose ?? ""}
                onChange={(e) => updateChar(i, { pose: e.target.value })}
                placeholder="Pose"
                className="h-7 text-xs"
              />
              <Input
                value={char.expression ?? ""}
                onChange={(e) => updateChar(i, { expression: e.target.value })}
                placeholder="Expression"
                className="h-7 text-xs"
              />
            </div>
            <Select
              value={char.position ?? "center"}
              onValueChange={(v) =>
                updateChar(i, { position: v as "left" | "center" | "right" | "background" })
              }
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="right">Right</SelectItem>
                <SelectItem value="background">Background</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={addChar} className="w-full">
          + Add Character
        </Button>
      </div>
    </FieldSection>
  );
}

// --- Dialogue Editor ---

function DialogueEditor({
  panel,
  onPatch,
}: {
  panel: PanelSpec;
  onPatch: (panelId: string, patch: Partial<PanelSpec>) => Promise<void>;
}): JSX.Element {
  const lines = panel.dialogueLines;

  const updateLine = (index: number, patch: Partial<PanelSpec["dialogueLines"][number]>) => {
    const newLines = lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
    void onPatch(panel.id, { dialogueLines: newLines });
  };

  const removeLine = (index: number) => {
    const newLines = lines.filter((_, i) => i !== index);
    void onPatch(panel.id, { dialogueLines: newLines });
  };

  const addLine = () => {
    void onPatch(panel.id, {
      dialogueLines: [...lines, { speaker: "", text: "", type: "speech" }],
    });
  };

  return (
    <FieldSection title="Dialogue">
      <div className="space-y-3">
        {lines.map((line, i) => (
          <div key={i} className="space-y-2 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Input
                value={line.speaker}
                onChange={(e) => updateLine(i, { speaker: e.target.value })}
                placeholder="Speaker"
                className="h-7 text-xs"
              />
              <Select
                value={line.type}
                onValueChange={(v) =>
                  updateLine(i, { type: v as "speech" | "thought" | "narration" | "sfx" })
                }
              >
                <SelectTrigger className="h-7 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="speech">Speech</SelectItem>
                  <SelectItem value="thought">Thought</SelectItem>
                  <SelectItem value="narration">Narration</SelectItem>
                  <SelectItem value="sfx">SFX</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" onClick={() => removeLine(i)} className="h-7 px-2">
                ×
              </Button>
            </div>
            <Textarea
              value={line.text}
              onChange={(e) => updateLine(i, { text: e.target.value })}
              placeholder="Dialogue text"
              rows={2}
              className="text-xs"
            />
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={addLine} className="w-full">
          + Add Dialogue Line
        </Button>
      </div>
    </FieldSection>
  );
}
