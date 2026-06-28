import { NextRequest, NextResponse } from 'next/server';
import { getRepo, getSql } from '@/lib/db';
import { startChapterTranscriptionActor } from '@/lib/actor-actions';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('retry');
export const dynamic = 'force-dynamic';

// POST /api/chapters/[id]/retry — reset chapter state and re-trigger transcription
// Clears old transcript chunks, resets status to pending, re-initializes actor
// identity, and starts a fresh transcription run. Use this when a transcription
// attempt failed or produced incomplete results.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;
  log.info('retry request', { chapterId });
  try {
    const repo = await getRepo();
    const chapter = await repo.chapters.getById(chapterId);
    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }
    if (!chapter.sourceAssetId) {
      return NextResponse.json({ error: 'No source asset linked to this chapter' }, { status: 400 });
    }

    // 1. Delete old transcript chunks for this chapter
    const sql = await getSql();
    if (sql) {
      await sql`DELETE FROM transcript_chunks WHERE chapter_id = ${chapterId}`;
    }

    // 2. Reset chapter status in DB
    await repo.chapters.patch(chapterId, {
      status: 'pending',
      transcriptionStatus: 'pending',
    } as Record<string, unknown>);

    // 3. Re-trigger transcription (actor Init is called internally to
    //    ensure identity is set before the transcription fiber starts)
    const result = await startChapterTranscriptionActor(
      chapterId,
      chapter.projectId,
      chapter.index,
    );

    return NextResponse.json({
      chapterId,
      status: 'transcribing',
      message: 'Chapter reset and transcription re-triggered.',
      result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
