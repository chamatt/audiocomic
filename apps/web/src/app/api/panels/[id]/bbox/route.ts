import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';
import { BoundingBox } from '@audiocomic/domain';

const log = logger.scoped('api:panel-bbox');

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const bboxResult = BoundingBox.safeParse(body.bbox ?? body);
    if (!bboxResult.success) {
      return Response.json(
        { error: 'Invalid bbox', details: bboxResult.error.flatten() },
        { status: 400 },
      );
    }

    const repo = await getRepo();
    const existing = await repo.panelSpecs.getById(id);
    if (!existing) {
      return Response.json({ error: 'Panel not found' }, { status: 404 });
    }

    const updated = await repo.panelSpecs.patch(id, { bbox: bboxResult.data });
    if (!updated) {
      return Response.json({ error: 'Failed to update bbox' }, { status: 500 });
    }

    return Response.json({ panel: updated });
  } catch (err) {
    log.error('Failed to update bbox', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to update bbox' }, { status: 500 });
  }
}
