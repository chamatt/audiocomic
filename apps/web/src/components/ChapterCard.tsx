import {
  Upload,
  FileText,
  Play,
  Clock,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ChapterCardChapter {
  id: string;
  index: number;
  title: string;
  description?: string;
  status: string;
  transcriptionStatus: string;
  durationSec?: number;
}

export interface ChapterCardProps {
  chapter: ChapterCardChapter;
  onUpload: (chapterId: string) => void;
  onViewTranscription: (chapterId: string) => void;
  onRunPipeline: (chapterId: string) => void;
}

// mm:ss formatting for an audio duration in seconds.
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  transcribing: "Transcribing",
  transcribed: "Transcribed",
  planning: "Planning",
  planned: "Planned",
  rendering: "Rendering",
  completed: "Completed",
  failed: "Failed",
};

export function ChapterCard({
  chapter,
  onUpload,
  onViewTranscription,
  onRunPipeline,
}: ChapterCardProps) {
  const { id, index, title, description, status, durationSec } = chapter;

  const badgeVariant =
    status === "pending"
      ? "outline"
      : status === "failed"
        ? "destructive"
        : status === "transcribed" ||
            status === "planned" ||
            status === "completed"
          ? "success"
          : "default"; // transcribing, planning, rendering

  // Warning-family statuses use the default badge variant with yellow text.
  const isWarningStatus =
    status === "transcribing" ||
    status === "planning" ||
    status === "rendering";

  const subtitle = durationSec
    ? `Chapter ${index} · ${formatDuration(durationSec)}`
    : `Chapter ${index}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <Badge
            variant={badgeVariant}
            className={cn(isWarningStatus && "text-yellow-600 dark:text-yellow-500")}
          >
            {STATUS_LABELS[status] ?? status}
          </Badge>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {durationSec ? (
              <>
                <Clock className="size-3" />
                {formatDuration(durationSec)}
              </>
            ) : null}
          </span>
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {description ? (
          <p className="text-sm text-muted-foreground line-clamp-3">
            {description}
          </p>
        ) : null}

        {status === "pending" ? (
          <Button variant="default" className="w-full" onClick={() => onUpload(id)}>
            <Upload />
            Upload Audio
          </Button>
        ) : null}

        {status === "transcribing" ? (
          <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Transcribing...
          </div>
        ) : null}

        {status === "transcribed" ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => onViewTranscription(id)}
            >
              <FileText />
              View Transcription
            </Button>
            <Button
              variant="default"
              className="w-full"
              onClick={() => onRunPipeline(id)}
            >
              <Play />
              Run Pipeline
            </Button>
          </div>
        ) : null}

        {status === "planned" || status === "completed" ? (
          <div className="space-y-2">
            {status === "completed" ? (
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" />
                <span>Completed</span>
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <Button variant="outline" className="w-full" disabled>
                <FileText />
                View Artifacts
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => onRunPipeline(id)}
              >
                <Play />
                Re-run Pipeline
              </Button>
            </div>
          </div>
        ) : null}

        {status === "failed" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" />
              <span>Processing failed</span>
            </div>
            <Button
              variant="default"
              className="w-full"
              onClick={() => onUpload(id)}
            >
              <Upload />
              Retry
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default ChapterCard;
