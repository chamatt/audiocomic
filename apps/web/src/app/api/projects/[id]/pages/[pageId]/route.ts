import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:page-detail');

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> },
) {
  const { id, pageId } = await params;
  try {
    const repo = await getRepo();
    const page = await repo.pageSpecs.getById(pageId);
    if (!page || page.projectId !== id) {
      return Response.json({ error: 'Page not found' }, { status: 404 });
    }

    const [allPanels, allComposites, allLettering, allResults] = await Promise.all([
      repo.panelSpecs.getByProjectId(id),
      repo.pageComposites.getByProjectId(id),
      repo.letteringSpecs.getByProjectId(id),
      repo.panelRenderResults.getByProjectId(id),
    ]);

    const panels = allPanels
      .filter((p) => p.pageId === pageId)
      .sort((a, b) => a.index - b.index);
    const composite = allComposites.find((c) => c.pageId === pageId);
    const lettering = allLettering.find((l) => l.pageId === pageId);

    const panelImages: Record<string, string> = {};
    for (const panel of panels) {
      if (panel.renderResultId) {
        const result = allResults.find((r) => r.id === panel.renderResultId);
        if (result) {
          panelImages[panel.id] = `/api/assets/${result.imageKey}`;
        }
      }
    }

    return Response.json({
      page,
      panels,
      compositeUrl: composite?.imageKey ? `/api/assets/${composite.imageKey}` : undefined,
      lettering: lettering?.boxes ?? [],
      panelImages,
    });
  } catch (err) {
    log.error('Failed to get page', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to get page' }, { status: 500 });
  }
}
