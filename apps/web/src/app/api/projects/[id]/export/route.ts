import { exportProjectAction } from '@/lib/actions';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:export');

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const type = body.type as 'pages' | 'mp4';
    if (type !== 'pages' && type !== 'mp4') {
      return Response.json({ error: 'Invalid export type. Use "pages" or "mp4".' }, { status: 400 });
    }
    await exportProjectAction(id, type);
    return Response.json({ status: 'pending', type });
  } catch (err) {
    log.error('Failed to create export job', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to create export job' }, { status: 500 });
  }
}
