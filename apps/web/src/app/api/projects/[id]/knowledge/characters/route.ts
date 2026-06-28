import { NextResponse, type NextRequest } from 'next/server';
import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:knowledge:characters');

// GET /api/projects/[id]/knowledge/characters — all character profiles
// extracted from ingested chapters, for the KB panel in the canvas.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  try {
    const repo = await getRepo();
    const characters = await repo.characterProfiles.getByProjectId(projectId);

    const result = characters.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      description: c.description,
      aliases: c.aliases ?? [],
    }));
    return NextResponse.json({ characters: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('characters route failed', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
