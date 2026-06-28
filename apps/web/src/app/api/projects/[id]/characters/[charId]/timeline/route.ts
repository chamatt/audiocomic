import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { getCharacterTimelineActor } from '@/lib/actor-actions';

export const dynamic = 'force-dynamic';

// GET /api/projects/[id]/characters/[charId]/timeline — character state timeline
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; charId: string }> },
) {
  const { id: projectId, charId } = await params;
  const repo = await getRepo();

  // 1. Get character states from DB
  const allStates = await repo.characterStates.getByProjectId(projectId);
  const timeline = allStates
    .filter((s) => s.characterId === charId)
    .sort((a, b) => a.chapterIndex - b.chapterIndex);

  // 2. Try to get timeline from bible actor (fire-and-forget)
  let actorTimeline: unknown = null;
  try {
    actorTimeline = await getCharacterTimelineActor('main', charId);
  } catch {
    // Actor may not be initialized
  }

  return NextResponse.json({ projectId, characterId: charId, timeline, actorTimeline });
}
