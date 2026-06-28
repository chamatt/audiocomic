import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { removeChapterFromProjectActor } from '@/lib/actor-actions';

export const dynamic = 'force-dynamic';

// DELETE /api/chapters/[id] — delete a chapter
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;
  const repo = await getRepo();
  const chapter = await repo.chapters.getById(chapterId);
  if (!chapter) {
    return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
  }

  // 1. Remove from project actor (fire-and-forget)
  removeChapterFromProjectActor('main', chapterId).catch(() => {});

  // 2. Delete from DB
  await repo.chapters.delete(chapterId);

  return NextResponse.json({ deleted: true, chapterId });
}
