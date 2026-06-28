import { NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const repo = await getRepo();
    const job = await repo.jobs.getById(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json({ id: job.id, state: job.state, type: job.type });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
