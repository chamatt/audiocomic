"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
  projectId: string;
  isRendering?: boolean;
  onPatch: (panelId: string, patch: Partial<PanelSpec>) => Promise<void>;
  onRegenerate: (panelId: string) => Promise<void>;
}
export function PanelEditor({
  panel,
  panelImageUrl,
  projectId,
  isRendering,
  onPatch,
  onRegenerate,
}: PanelEditorProps): JSX.Element | null {
  if (!panel) {
    return null;
  }
  const handleRegenerate = () => {
    void onRegenerate(panel.id);
  };
  return (
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

      {/* Render Prompt — LLM-generated, display only */}
      <FieldSection title="Render Prompt (LLM-generated)">
        <textarea
          value={panel.renderPrompt ?? ""}
          readOnly
          disabled
          placeholder="No prompt yet — click Regenerate to generate"
          rows={4}
          className="w-full resize-none rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground"
        />
      </FieldSection>

      <FieldSection title="Negative Prompt (editable)">
        <DebouncedTextarea
          key={`neg-${panel.id}`}
          value={panel.renderNegativePrompt ?? ""}
          onChange={(v) => onPatch(panel.id, { renderNegativePrompt: v || undefined })}
          placeholder="No negative prompt yet"
          rows={2}
          className="w-full resize-none rounded-md border bg-background px-3 py-2 font-mono text-xs"
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
        disabled={isRendering}
        className="w-full"
        variant="default"
      >
        {isRendering ? "Regenerating..." : "Regenerate Panel"}
      </Button>

      <Separator />

      {/* Characters */}
      <CharacterEditor panel={panel} projectId={projectId} onPatch={onPatch} />

      <Separator />

      {/* Dialogue */}
      <DialogueEditor panel={panel} onPatch={onPatch} />
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

export function QaBadge({ status }: { status: PanelSpec["qaStatus"] }): JSX.Element {
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

interface ProjectCharacter {
  id: string;
  name: string;
  role: string;
  description: string;
  aliases: string[];
}

function CharacterEditor({
  panel,
  projectId,
  onPatch,
}: {
  panel: PanelSpec;
  projectId: string;
  onPatch: (panelId: string, patch: Partial<PanelSpec>) => Promise<void>;
}): JSX.Element {
  const characters = panel.characters;
  const [projectChars, setProjectChars] = useState<ProjectCharacter[]>([]);
  const [openCombos, setOpenCombos] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const fetchChars = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/knowledge/characters`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { characters: ProjectCharacter[] };
          setProjectChars(data.characters ?? []);
        }
      } catch {
        /* non-fatal */
      }
    };
    void fetchChars();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const charById = useMemo(() => new Map(projectChars.map((c) => [c.id, c])), [projectChars]);

  const updateChar = (index: number, patch: Partial<PanelSpec["characters"][number]>) => {
    const newChars = characters.map((c, i) => (i === index ? { ...c, ...patch } : c));
    void onPatch(panel.id, { characters: newChars });
  };

  const removeChar = (index: number) => {
    const newChars = characters.filter((_, i) => i !== index);
    void onPatch(panel.id, { characters: newChars });
  };

  const addChar = () => {
    const firstId = projectChars[0]?.id ?? crypto.randomUUID();
    void onPatch(panel.id, {
      characters: [...characters, { characterId: firstId, position: "center" }],
    });
  };

  return (
    <FieldSection title="Characters">
      <div className="space-y-3">
        {characters.map((char, i) => {
          const selected = charById.get(char.characterId);

          return (
            <div key={i} className="space-y-2 rounded-md border p-2">
              <div className="flex items-center justify-between">
                <Popover
                  open={openCombos[i] ?? false}
                  onOpenChange={(open) => setOpenCombos((s) => ({ ...s, [i]: open }))}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="h-7 text-xs flex-1 mr-1 justify-between font-normal"
                    >
                      {selected ? (
                        <span className="truncate">
                          {selected.name}
                          <span className="text-muted-foreground ml-1">({selected.role})</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Select character…</span>
                      )}
                      <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search characters…" className="h-8" />
                      <CommandList>
                        <CommandEmpty>No character found.</CommandEmpty>
                        <CommandGroup>
                          {projectChars.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${c.name} ${c.aliases.join(" ")} ${c.role}`}
                              onSelect={() => {
                                updateChar(i, { characterId: c.id });
                                setOpenCombos((s) => ({ ...s, [i]: false }));
                              }}
                              className="text-xs"
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-3 w-3",
                                  char.characterId === c.id ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <span className="font-medium">{c.name}</span>
                              <span className="text-muted-foreground ml-1">({c.role})</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeChar(i)}
                  className="h-7 px-2"
                >
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
          );
        })}
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
