import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:page-reorder');

// PATCH — update reading order for a page
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pageId } = await params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const repo = await getRepo();

    const page = await repo.pageSpecs.getById(pageId);
    if (!page) {
      return Response.json({ error: 'Page not found' }, { status: 404 });
    }

    const patch: Record<string, unknown> = {};
    if (body.readingOrder !== undefined) {
      patch.readingOrder = body.readingOrder as string[];
    }
    if (body.index !== undefined) {
      patch.index = body.index as number;
    }
    if (body.panelIds !== undefined) {
      patch.panelIds = body.panelIds as string[];
    }

    if (Object.keys(patch).length === 0) {
      return Response.json({ error: 'No fields to update' }, { status: 400 });
    }

    const updated = await repo.pageSpecs.patch(pageId, patch);
    return Response.json({ page: updated });
  } catch (err) {
    log.error('Failed to reorder page', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to reorder page' }, { status: 500 });
  }
}
