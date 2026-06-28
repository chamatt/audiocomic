import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { getChapterStateActor } from '@/lib/actor-actions';

export const dynamic = 'force-dynamic';

// GET /api/chapters/[id]/status — get chapter status (DB + actor state)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;
  const repo = await getRepo();
  const chapter = await repo.chapters.getById(chapterId);
  if (!chapter) {
    return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
  }

  // Try to get live actor state (fire-and-forget — don't block on actor timeout)
  let actorState: unknown = null;
  try {
    const result = await getChapterStateActor(chapterId);
    actorState = result;
  } catch {
    // Actor may not be initialized yet — return DB state only
  }

  return NextResponse.json({ chapter, actorState });
}
