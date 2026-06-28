import { NextRequest, NextResponse } from 'next/server';
import { startChapterTranscriptionActor } from '@/lib/actor-actions';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/chapters/[id]/transcribe — manually trigger transcription
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;
  try {
    // Fetch chapter from DB to pass identity to the actor (ensures Init
    // is called for actors created by older server versions).
    const repo = await getRepo();
    const chapter = await repo.chapters.getById(chapterId);
    const result = await startChapterTranscriptionActor(
      chapterId,
      chapter?.projectId,
      chapter?.index,
    );
    return NextResponse.json({ chapterId, status: 'transcribing', result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
