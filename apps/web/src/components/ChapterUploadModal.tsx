"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Loader2, X } from "lucide-react";

interface ChapterUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapterId: string;
  chapterTitle: string;
  onUploaded: () => void;
}

const ACCEPTED_AUDIO = ".mp3,.wav,.m4a,.m4b,.flac,.ogg,audio/*";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  const rounded = value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[i]}`;
}

function isErrorWithMessage(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

export function ChapterUploadModal({
  open,
  onOpenChange,
  chapterId,
  chapterTitle,
  onUploaded,
}: ChapterUploadModalProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [status, setStatus] = React.useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = React.useState<string>("");

  // Reset state whenever the modal is closed.
  React.useEffect(() => {
    if (!open) {
      setFile(null);
      setStatus("idle");
      setErrorMsg("");
    }
  }, [open]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setStatus("idle");
    setErrorMsg("");
  };

  const handleClearFile = () => {
    setFile(null);
    setStatus("idle");
    setErrorMsg("");
  };

  const handleUpload = async () => {
    if (!file) return;

    setStatus("uploading");
    setErrorMsg("");

    const formData = new FormData();
    formData.append("audio", file);

    try {
      const res = await fetch(`/api/chapters/${chapterId}/upload`, {
        method: "POST",
        body: formData,
      });

      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          (isErrorWithMessage(data) && data.error) ||
          `Upload failed (${res.status})`;
        setStatus("error");
        setErrorMsg(message);
        return;
      }

      setStatus("success");
      onUploaded();
      // Close shortly after showing the success message.
      setTimeout(() => onOpenChange(false), 1200);
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error ? err.message : "Network error during upload",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload audio</DialogTitle>
          <DialogDescription>
            Upload an audio file for{" "}
            <span className="font-medium text-foreground">{chapterTitle}</span>.
            Transcription starts automatically once the upload completes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="audio-file">Audio file</Label>
            <div className="flex items-center gap-2">
              <Input
                id="audio-file"
                type="file"
                accept={ACCEPTED_AUDIO}
                onChange={handleFileChange}
                disabled={status === "uploading"}
                className="flex-1"
              />
              {file && status !== "uploading" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleClearFile}
                  aria-label="Clear selected file"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          </div>

          {file && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div className="font-medium truncate">{file.name}</div>
              <div className="text-muted-foreground">
                {formatBytes(file.size)}
              </div>
            </div>
          )}

          {status === "success" && (
            <p
              role="status"
              className="text-sm font-medium text-emerald-600 dark:text-emerald-500"
            >
              Audio uploaded. Transcription started.
            </p>
          )}

          {status === "error" && (
            <p
              role="alert"
              className="text-sm font-medium text-destructive"
            >
              {errorMsg}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={status === "uploading"}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!file || status === "uploading" || status === "success"}
          >
            {status === "uploading" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="size-4" />
                Upload
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ChapterUploadModal;
