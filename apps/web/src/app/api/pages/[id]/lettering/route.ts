import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';
import { uuid, nowIso } from '@audiocomic/shared';
import { LetteringBox } from '@audiocomic/domain';

const log = logger.scoped('api:lettering');

// GET lettering boxes for a page
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pageId } = await params;
  try {
    const repo = await getRepo();
    const allLettering = await repo.letteringSpecs.getByProjectId(
      // We need the projectId — get it from the page
      (await repo.pageSpecs.getById(pageId))?.projectId ?? '',
    );
    const lettering = allLettering.find((l) => l.pageId === pageId);
    return Response.json({ boxes: lettering?.boxes ?? [] });
  } catch (err) {
    log.error('Failed to get lettering', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to get lettering' }, { status: 500 });
  }
}

// POST — add a new bubble to a page
export async function POST(
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

    // Create a new LetteringBox with a generated id
    const newBox = {
      id: uuid(),
      type: (body.type as 'speech' | 'thought' | 'narration' | 'sfx' | 'caption') ?? 'speech',
      text: (body.text as string) ?? '',
      bbox: (body.bbox as { x: number; y: number; w: number; h: number }) ?? { x: 0.1, y: 0.1, w: 0.3, h: 0.15 },
      panelId: body.panelId as string | undefined,
      speaker: body.speaker as string | undefined,
    };

    const parsed = LetteringBox.safeParse(newBox);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid lettering box', details: parsed.error.flatten() }, { status: 400 });
    }

    // Find or create lettering spec for this page
    const allLettering = await repo.letteringSpecs.getByProjectId(page.projectId);
    const existing = allLettering.find((l) => l.pageId === pageId);

    if (existing) {
      const updated = await repo.letteringSpecs.patch(existing.id, {
        boxes: [...existing.boxes, parsed.data],
        version: existing.version + 1,
      });
      return Response.json({ lettering: updated, box: parsed.data });
    }

    // Create new lettering spec
    const created = await repo.letteringSpecs.create({
      id: uuid(),
      pageId,
      projectId: page.projectId,
      boxes: [parsed.data],
      version: 0,
      createdAt: nowIso(),
    });
    return Response.json({ lettering: created, box: parsed.data });
  } catch (err) {
    log.error('Failed to add lettering box', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to add lettering box' }, { status: 500 });
  }
}
