import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { createProjectActor, createBibleActor, linkBibleActor } from '@/lib/actor-actions';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:project:setup');

export const dynamic = 'force-dynamic';

// POST /api/projects/[id]/setup — lazily initialize project + bible actors.
// Called from the client on first project detail view. Idempotent.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  try {
    const repo = await getRepo();
    const project = await repo.projects.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const projectRes = await createProjectActor(project.name, project.description ?? '');
    if (!projectRes.ok) {
      log.warn('createProjectActor failed', { projectId, error: projectRes.error });
    } else {
      const bibleRes = await createBibleActor(project.name, `Story bible for ${project.name}`);
      if (bibleRes.ok) {
        await linkBibleActor(projectRes.data.key, bibleRes.data.content.id);
      } else {
        log.warn('createBibleActor failed', { projectId, error: bibleRes.error });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('setup failed', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
