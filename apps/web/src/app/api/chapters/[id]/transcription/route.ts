import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/chapters/[id]/transcription — get transcription chunks for a chapter
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;
  const repo = await getRepo();

  // Get all transcript chunks for the project, filter by chapterId
  // In the future, add a dedicated query for getByChapterId
  const chapter = await repo.chapters.getById(chapterId);
  if (!chapter) {
    return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
  }

  const allChunks = await repo.transcriptChunks.getByProjectId(chapter.projectId);
  const chapterChunks = allChunks.filter((c) => c.chapterId === chapterId);
  chapterChunks.sort((a, b) => a.index - b.index);

  return NextResponse.json({
    chapterId,
    chapterTitle: chapter.title,
    chunkCount: chapterChunks.length,
    chunks: chapterChunks,
  });
}
