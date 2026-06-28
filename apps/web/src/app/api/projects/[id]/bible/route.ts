import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/projects/[id]/bible — get bible content (world, characters, scenes)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const repo = await getRepo();

  const [worldBibles, characters, scenes, objects] = await Promise.all([
    repo.worldBibles.getByProjectId(projectId),
    repo.characterProfiles.getByProjectId(projectId),
    repo.sceneProfiles.getByProjectId(projectId),
    repo.objectProfiles.getByProjectId(projectId),
  ]);

  return NextResponse.json({
    projectId,
    worldBible: worldBibles[0] ?? null,
    characters,
    scenes,
    objects,
  });
}
