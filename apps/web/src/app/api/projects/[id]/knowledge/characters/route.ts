import { NextResponse, type NextRequest } from 'next/server';
import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';
import { mergeTwoCharacters } from "@audiocomic/actors/src/agents/merge.ts";

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

// POST /api/projects/[id]/knowledge/characters — merge two characters
// Body: { sourceId: string, targetId: string }
// Merges source into target: aliases, description, role are merged;
// all section/panel/state references are remapped; source is deleted.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  try {
    const body = await req.json();
    const { sourceId, targetId } = body as { sourceId?: string; targetId?: string };

    if (!sourceId || !targetId) {
      return NextResponse.json(
        { error: 'sourceId and targetId are required' },
        { status: 400 },
      );
    }
    if (sourceId === targetId) {
      return NextResponse.json(
        { error: 'Cannot merge a character with itself' },
        { status: 400 },
      );
    }

    const repo = await getRepo();
    const result = await mergeTwoCharacters(repo, projectId, sourceId, targetId);

    log.info('Character merge', { projectId, sourceId, targetId, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('character merge failed', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
