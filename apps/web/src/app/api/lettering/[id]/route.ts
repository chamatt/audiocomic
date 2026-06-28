import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';
import { LetteringBox } from '@audiocomic/domain';

const log = logger.scoped('api:lettering-item');

// PATCH — update a single bubble (identified by box id in the body)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pageId } = await params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const boxId = body.boxId as string;
    if (!boxId) {
      return Response.json({ error: 'boxId is required' }, { status: 400 });
    }

    const repo = await getRepo();
    const page = await repo.pageSpecs.getById(pageId);
    if (!page) {
      return Response.json({ error: 'Page not found' }, { status: 404 });
    }

    const allLettering = await repo.letteringSpecs.getByProjectId(page.projectId);
    const lettering = allLettering.find((l) => l.pageId === pageId);
    if (!lettering) {
      return Response.json({ error: 'Lettering spec not found' }, { status: 404 });
    }

    const boxIndex = lettering.boxes.findIndex((b) => b.id === boxId);
    if (boxIndex === -1) {
      return Response.json({ error: 'Bubble not found' }, { status: 404 });
    }

    // Merge patch into existing box
    const existing = lettering.boxes[boxIndex];
    const merged = {
      ...existing,
      ...(body.text !== undefined ? { text: body.text as string } : {}),
      ...(body.bbox !== undefined ? { bbox: body.bbox as { x: number; y: number; w: number; h: number } } : {}),
      ...(body.type !== undefined ? { type: body.type as 'speech' | 'thought' | 'narration' | 'sfx' | 'caption' } : {}),
      ...(body.speaker !== undefined ? { speaker: body.speaker as string } : {}),
      ...(body.panelId !== undefined ? { panelId: body.panelId as string } : {}),
    };

    const parsed = LetteringBox.safeParse(merged);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid lettering box', details: parsed.error.flatten() }, { status: 400 });
    }

    const newBoxes = [...lettering.boxes];
    newBoxes[boxIndex] = parsed.data;

    const updated = await repo.letteringSpecs.patch(lettering.id, {
      boxes: newBoxes,
      version: lettering.version + 1,
    });

    return Response.json({ lettering: updated, box: parsed.data });
  } catch (err) {
    log.error('Failed to update lettering box', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to update lettering box' }, { status: 500 });
  }
}

// DELETE — remove a bubble (boxId passed as query param)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pageId } = await params;
  try {
    const url = new URL(request.url);
    const boxId = url.searchParams.get('boxId');
    if (!boxId) {
      return Response.json({ error: 'boxId query param is required' }, { status: 400 });
    }

    const repo = await getRepo();
    const page = await repo.pageSpecs.getById(pageId);
    if (!page) {
      return Response.json({ error: 'Page not found' }, { status: 404 });
    }

    const allLettering = await repo.letteringSpecs.getByProjectId(page.projectId);
    const lettering = allLettering.find((l) => l.pageId === pageId);
    if (!lettering) {
      return Response.json({ error: 'Lettering spec not found' }, { status: 404 });
    }

    const newBoxes = lettering.boxes.filter((b) => b.id !== boxId);
    const updated = await repo.letteringSpecs.patch(lettering.id, {
      boxes: newBoxes,
      version: lettering.version + 1,
    });

    return Response.json({ lettering: updated });
  } catch (err) {
    log.error('Failed to delete lettering box', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to delete lettering box' }, { status: 500 });
  }
}

