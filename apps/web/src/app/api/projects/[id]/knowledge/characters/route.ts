import { NextResponse, type NextRequest } from 'next/server';
import { getRepo } from '@/lib/db';
import { getEnv, logger } from '@audiocomic/shared';
import { resolveLanguageModel, type LLMProvider } from '@audiocomic/ai';
import { mergeTwoCharacters, cleanupCharacterDescription } from "@audiocomic/actors/src/agents/merge.ts";

const log = logger.scoped('api:knowledge:characters');

function getProjectModel(project?: { llmProvider?: string | null; llmModel?: string | null }) {
  const env = getEnv();
  const provider = (project?.llmProvider ?? env.LLM_PROVIDER) as LLMProvider | undefined;
  const model = project?.llmModel ?? env.DEFAULT_LLM_MODEL;
  if (!provider || !model) return undefined;
  try {
    return resolveLanguageModel(provider, model, env);
  } catch {
    return undefined;
  }
}

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
      paletteNotes: c.paletteNotes ?? [],
      negativeConstraints: c.negativeConstraints ?? [],
    }));
    return NextResponse.json({ characters: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('characters route failed', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/projects/[id]/knowledge/characters — edit a single character
// Body: { characterId, name?, description?, role?, aliases? }
// Editing the description marks all panels referencing this character as
// prompt-stale so the LLM optimizer re-optimizes on next regenerate.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  try {
    const body = await req.json();
    const { characterId, ...fields } = body as {
      characterId?: string;
      name?: string;
      description?: string;
      role?: string;
      aliases?: string[];
    };

    if (!characterId) {
      return NextResponse.json({ error: 'characterId is required' }, { status: 400 });
    }

    const repo = await getRepo();
    const existing = await repo.characterProfiles.getById(characterId);
    if (!existing || existing.projectId !== projectId) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    const patch: Record<string, unknown> = {};
    if (typeof fields.name === 'string' && fields.name.trim()) patch.name = fields.name.trim();
    if (typeof fields.description === 'string') patch.description = fields.description;
    if (typeof fields.role === 'string') patch.role = fields.role;
    if (Array.isArray(fields.aliases)) patch.aliases = fields.aliases;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await repo.characterProfiles.patch(characterId, patch);

    // If description changed, mark all panels referencing this character stale.
    if ('description' in patch && patch.description !== existing.description) {
      try {
        const allPanels = await repo.panelSpecs.getByProjectId(projectId);
        await Promise.all(
          allPanels
            .filter((p) => p.characters.some((c) => c.characterId === characterId))
            .map((p) => repo.panelSpecs.patch(p.id, { promptStale: true })),
        );
      } catch (e) {
        log.warn('Failed to mark panels stale after character edit', {
          characterId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    log.info('Character edited', { projectId, characterId, fields: Object.keys(patch) });
    return NextResponse.json({ ok: true, character: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('character PATCH failed', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/projects/[id]/knowledge/characters — merge or cleanup characters
// Body: { action: "merge", sourceId, targetId } | { action: "cleanup", characterId }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  try {
    const body = await req.json();
    const action = body.action as string | undefined;

    const repo = await getRepo();

    if (action === 'cleanup') {
      const { characterId } = body as { characterId?: string };
      if (!characterId) {
        return NextResponse.json({ error: 'characterId is required' }, { status: 400 });
      }
      const project = await repo.projects.getById(projectId);
      const model = getProjectModel(project ?? undefined);
      if (!model) {
        return NextResponse.json({ error: 'No LLM configured' }, { status: 400 });
      }
      const result = await cleanupCharacterDescription(repo, characterId, model);
      log.info('Description cleanup', { projectId, characterId, ...result });
      return NextResponse.json({ ok: true, ...result });
    }

    // Default action: merge
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

    const project = await repo.projects.getById(projectId);
    const model = getProjectModel(project ?? undefined);
    const result = await mergeTwoCharacters(repo, projectId, sourceId, targetId, model);

    log.info('Character merge', { projectId, sourceId, targetId, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('character action failed', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
