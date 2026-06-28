import { NextResponse, type NextRequest } from 'next/server';
import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:knowledge:world');

// GET /api/projects/[id]/knowledge/world — all world bible entries
// and knowledge pages extracted from ingested chapters.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  try {
    const repo = await getRepo();
    const [worldBibles, knowledgePages] = await Promise.all([
      repo.worldBibles.getByProjectId(projectId),
      repo.knowledgePages.getByProjectId(projectId),
    ]);

    const world = worldBibles.map((w) => ({
      id: w.id,
      setting: w.setting,
      genre: w.genre ?? [],
      tone: w.tone ?? '',
      artStyle: w.artStyle ?? '',
    }));

    const pages = knowledgePages.map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      content: p.content,
      updatedAt: p.updatedAt,
    }));

    return NextResponse.json({ world, pages });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('world route failed', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
