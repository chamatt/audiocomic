import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/projects/[id]/chapters — list chapters for a project
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const repo = await getRepo();
  const chapters = await repo.chapters.getByProjectId(projectId);
  // Sort by index
  chapters.sort((a, b) => a.index - b.index);
  return NextResponse.json(chapters);
}
