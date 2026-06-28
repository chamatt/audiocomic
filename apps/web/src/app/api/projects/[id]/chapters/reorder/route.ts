import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { reorderChaptersActor } from '@/lib/actor-actions';

export const dynamic = 'force-dynamic';

// PUT /api/projects/[id]/chapters/reorder — reorder chapters within a project
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const body = await req.json();
  const { chapterIds } = body as { chapterIds: string[] };

  if (!Array.isArray(chapterIds)) {
    return NextResponse.json({ error: 'chapterIds array is required' }, { status: 400 });
  }

  const repo = await getRepo();

  // Update each chapter's index in the DB
  for (let i = 0; i < chapterIds.length; i++) {
    await repo.chapters.patch(chapterIds[i]!, { index: i });
  }

  // Sync to project actor (fire-and-forget)
  reorderChaptersActor('main', chapterIds).catch(() => {});

  return NextResponse.json({ projectId, chapterIds, reordered: true });
}
