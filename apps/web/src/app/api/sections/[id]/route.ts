import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:section-update');

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const repo = await getRepo();

    // Build patch from only editable fields
    const patch: { title?: string; summary?: string } = {};
    if (typeof body.title === 'string') {
      patch.title = body.title;
    }
    if (typeof body.summary === 'string') {
      patch.summary = body.summary;
    }

    if (Object.keys(patch).length === 0) {
      return Response.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await repo.storySections.patch(id, patch);
    if (!updated) {
      return Response.json({ error: 'Section not found' }, { status: 404 });
    }

    return Response.json(updated);
  } catch (err) {
    log.error('Failed to update section', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to update section' }, { status: 500 });
  }
}
