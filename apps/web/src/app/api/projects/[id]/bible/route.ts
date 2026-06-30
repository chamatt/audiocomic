import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';
import type { WorldBible } from '@audiocomic/domain';

export const dynamic = 'force-dynamic';

const log = logger.scoped('api:bible');

// Editable fields on the world bible.
const EDITABLE_FIELDS = [
  'setting',
  'tone',
  'artStyle',
  'artStyleNegative',
  'colorPalette',
  'genre',
  'worldRules',
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

function isEditableField(key: string): key is EditableField {
  return (EDITABLE_FIELDS as readonly string[]).includes(key);
}

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

// PATCH /api/projects/[id]/bible — update the project's world bible.
// Creates the world bible if it doesn't exist yet (with a default art style).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const repo = await getRepo();

    const existing = await repo.worldBibles.getByProjectId(projectId);
    const worldBible = existing[0];

    const patch: Partial<WorldBible> = {};
    for (const [key, value] of Object.entries(body)) {
      if (isEditableField(key) && value !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (patch as Record<string, unknown>)[key] = value;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    if (worldBible) {
      const updated = await repo.worldBibles.patch(worldBible.id, patch);
      return NextResponse.json({ worldBible: updated });
    }

    // No world bible yet — create one with the patch + defaults.
    log.info('Creating world bible on first PATCH', { projectId });
    return NextResponse.json(
      { error: 'No world bible exists for this project yet — run the planner first' },
      { status: 409 },
    );
  } catch (err) {
    log.error('Failed to update world bible', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to update world bible' },
      { status: 500 },
    );
  }
}
