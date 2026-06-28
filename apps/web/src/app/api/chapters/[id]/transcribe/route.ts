import { NextRequest, NextResponse } from 'next/server';
import { startChapterTranscriptionActor } from '@/lib/actor-actions';

export const dynamic = 'force-dynamic';

// POST /api/chapters/[id]/transcribe — manually trigger transcription
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;
  try {
    const result = await startChapterTranscriptionActor(chapterId);
    return NextResponse.json({ chapterId, status: 'transcribing', result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
