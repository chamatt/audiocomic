"use client";

import type { JSX } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  label: string;
}

interface CanvasSettingsPopoverProps {
  imageProvider: string;
  imageProviderOptions: readonly Option[];
  onImageProviderChange: (v: string) => void;

  imageModel: string;
  imageModelOptions: readonly Option[];
  onImageModelChange: (v: string) => void;

  llmProvider: string;
  llmProviderOptions: readonly Option[];
  onLlmProviderChange: (v: string) => void;

  llmModel: string;
  llmModelOptions: readonly Option[];
  onLlmModelChange: (v: string) => void;

  artStyle: string;
  onArtStyleChange: (v: string) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function PlainSelect({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: readonly Option[];
  onChange: (v: string) => void;
  placeholder: string;
}): JSX.Element {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Gathers all the generation settings (image model/provider, LLM model/provider,
 *  art style) that used to clutter the top toolbar into one tidy popover. */
export function CanvasSettingsPopover(props: CanvasSettingsPopoverProps): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Generation settings"
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted",
          )}
        >
          <span aria-hidden>⚙</span>
          Settings
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="space-y-3">
          <p className="text-xs font-semibold">Image generation</p>
          <Field label="Provider">
            <PlainSelect
              value={props.imageProvider}
              options={props.imageProviderOptions}
              onChange={props.onImageProviderChange}
              placeholder="Select provider"
            />
          </Field>
          <Field label="Model">
            <PlainSelect
              value={props.imageModel}
              options={props.imageModelOptions}
              onChange={props.onImageModelChange}
              placeholder="Select model"
            />
          </Field>
          <Field label="Art style">
            <Textarea
              value={props.artStyle}
              onChange={(e) => props.onArtStyleChange(e.target.value)}
              placeholder="comic book art"
              rows={2}
              className="text-xs"
            />
          </Field>
        </div>

        <div className="space-y-3 border-t pt-3">
          <p className="text-xs font-semibold">Story planning (LLM)</p>
          <Field label="Provider">
            <PlainSelect
              value={props.llmProvider}
              options={props.llmProviderOptions}
              onChange={props.onLlmProviderChange}
              placeholder="Select provider"
            />
          </Field>
          <Field label="Model">
            <PlainSelect
              value={props.llmModel}
              options={props.llmModelOptions}
              onChange={props.onLlmModelChange}
              placeholder="Select model"
            />
          </Field>
        </div>
      </PopoverContent>
    </Popover>
  );
}
