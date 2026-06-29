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
    }));
    return NextResponse.json({ characters: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('characters route failed', { projectId, error: msg });
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
