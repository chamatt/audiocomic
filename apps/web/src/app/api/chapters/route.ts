import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { uuid, nowIso } from '@audiocomic/shared';
import { createChapterActor, addChapterToProjectActor } from '@/lib/actor-actions';

export const dynamic = 'force-dynamic';

// POST /api/chapters — create a chapter within a project
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { projectId, title, description, index } = body as {
    projectId: string;
    title: string;
    description?: string;
    index?: number;
  };
  const repo = await getRepo();
  if (!projectId || !title) {
    return NextResponse.json({ error: 'projectId and title are required' }, { status: 400 });
  }

  // Determine the next index if not provided
  const existing = await repo.chapters.getByProjectId(projectId);
  const chapterIndex = index ?? existing.length;

  const chapterId = uuid();
  const now = nowIso();

  // 1. Create chapter in DB
  const chapter = await repo.chapters.create({
    id: chapterId,
    projectId,
    index: chapterIndex,
    title,
    description,
    status: 'pending',
    transcriptionStatus: 'pending',
    createdAt: now,
    updatedAt: now,
  });

  // 2. Create chapter actor (fire-and-forget)
  createChapterActor(chapterId, projectId, chapterIndex, title, description).catch(() => {
    // Actor creation is lazy — will retry on first access
  });

  // 3. Register chapter with project actor (fire-and-forget)
  addChapterToProjectActor('main', chapterId, title, chapterIndex).catch(() => {
    // Project actor will pick it up on next ListChapters
  });

  return NextResponse.json(chapter, { status: 201 });
}
