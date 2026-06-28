import { NextResponse, type NextRequest } from "next/server";
import { getRepo } from "@/lib/db";
import { startChapterIngestActor } from "@/lib/actor-actions";
import { logger } from "@audiocomic/shared";

const log = logger.scoped("api:chapter:ingest");

// POST /api/chapters/[id]/ingest — trigger knowledge ingestion for a single chapter.
// The ChapterActor's StartIngest action embeds transcript chunks, runs wiki ingest,
// and builds the bible. Auto-advances to plan after completion.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: chapterId } = await params;
  try {
    const repo = await getRepo();
    const chapter = await repo.chapters.getById(chapterId);
    if (!chapter) {
      return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    }

    // Allow ingest from pending or failed stage (retry).
    if (
      chapter.stage !== "pending" &&
      chapter.stage !== "failed" &&
      chapter.stage !== "ingesting"
    ) {
      return NextResponse.json(
        { error: `Chapter must be at pending or failed stage (current: ${chapter.stage})` },
        { status: 400 },
      );
    }

    const result = await startChapterIngestActor(chapterId, chapter.projectId, chapter.index);
    if (!result.ok) {
      log.error("ingest actor failed", { chapterId, error: result.error });
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      chapterId,
      status: "ingesting",
      message: "Knowledge ingestion started. Will auto-advance to plan → ready_for_review.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("ingest route failed", { chapterId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
