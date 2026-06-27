import { getDb, repo } from '@/lib/db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { getProjectDetail } = await import('@/lib/actions');
  try {
    const detail = await getProjectDetail(id);
    return Response.json({ detail });
  } catch {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }
}
