import { NextResponse, type NextRequest } from 'next/server';
import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:board');

// GET /api/projects/[id]/board — returns all chapters with their current
// stage, progress, and page count for the chapter board UI.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  try {
    const repo = await getRepo();
    const chapters = await repo.chapters.getByProjectId(projectId);

    // Get page counts per chapter.
    const pages = await repo.pageSpecs.getByProjectId(projectId);
    const pageCountByChapter = new Map<string, number>();
    for (const page of pages) {
      if (page.chapterId) {
        pageCountByChapter.set(
          page.chapterId,
          (pageCountByChapter.get(page.chapterId) ?? 0) + 1,
        );
      }
    }

    // Get ingest log to know which chapters have been ingested.
    const ingestLog = await repo.chapterIngestLog.getByProjectId(projectId);
    const ingestedChapterIds = new Set(ingestLog.map((l) => l.chapterId));

    const board = chapters.map((ch) => ({
      id: ch.id,
      index: ch.index,
      title: ch.title,
      stage: ch.stage ?? 'pending',
      stageProgress: ch.stageProgress ?? null,
      status: ch.status,
      transcriptionStatus: ch.transcriptionStatus,
      pageCount: pageCountByChapter.get(ch.id) ?? 0,
      ingested: ingestedChapterIds.has(ch.id),
      durationSec: ch.durationSec ?? null,
    }));

    // Sort by index.
    board.sort((a, b) => a.index - b.index);

    return NextResponse.json({ chapters: board });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('board route failed', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
