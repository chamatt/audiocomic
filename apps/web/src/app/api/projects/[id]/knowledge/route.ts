import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { getKnowledgeWikiActor, getKnowledgeBaseStatusActor } from '@/lib/actor-actions';

export const dynamic = 'force-dynamic';

// GET /api/projects/[id]/knowledge — get knowledge base (wiki pages + status)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const repo = await getRepo();

  // 1. Get wiki pages from DB
  const wikiPages = await repo.knowledgePages.getByProjectId(projectId);

  // 2. Get character states from DB
  const characterStates = await repo.characterStates.getByProjectId(projectId);

  // 3. Get knowledge base actor status (fire-and-forget — don't block)
  let kbStatus: unknown = null;
  try {
    const result = await getKnowledgeBaseStatusActor(projectId);
    kbStatus = result;
  } catch {
    // Actor may not be initialized
  }

  // 4. Try to get wiki from actor (may have more recent data)
  let actorWiki: unknown = null;
  try {
    actorWiki = await getKnowledgeWikiActor(projectId);
  } catch {
    // Actor may not be initialized
  }

  return NextResponse.json({
    projectId,
    wikiPages,
    characterStates,
    kbStatus,
    actorWiki,
  });
}
