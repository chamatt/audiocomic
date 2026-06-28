import { NextResponse, type NextRequest } from 'next/server';
import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:knowledge:timeline');

// GET /api/projects/[id]/knowledge/timeline — character state changes
// across chapters, ordered by chapter index.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  try {
    const repo = await getRepo();
    const [states, characters, chapters] = await Promise.all([
      repo.characterStates.getByProjectId(projectId),
      repo.characterProfiles.getByProjectId(projectId),
      repo.chapters.getByProjectId(projectId),
    ]);

    const charNameById = new Map(characters.map((c) => [c.id, c.name]));
    const chapterTitleById = new Map(chapters.map((c) => [c.id, c.title]));

    const timeline = states
      .map((s) => ({
        id: s.id,
        characterId: s.characterId,
        characterName: charNameById.get(s.characterId) ?? 'Unknown',
        chapterId: s.chapterId,
        chapterTitle: chapterTitleById.get(s.chapterId) ?? '',
        chapterIndex: s.chapterIndex,
        outfit: s.outfit ?? null,
        location: s.location ?? null,
        mood: s.mood ?? null,
        notes: s.notes ?? null,
      }))
      .sort((a, b) => a.chapterIndex - b.chapterIndex);

    return NextResponse.json({ timeline });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('timeline route failed', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
