import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:pages');

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const repo = await getRepo();
    const pages = await repo.pageSpecs.getByProjectId(id);

    const pagesWithPanels = await Promise.all(
      pages.map(async (page) => {
        const allPanels = await repo.panelSpecs.getByProjectId(id);
        const panels = allPanels.filter((p) => p.pageId === page.id);

        const allComposites = await repo.pageComposites.getByProjectId(id);
        const composite = allComposites.find((c) => c.pageId === page.id);

        const allLettering = await repo.letteringSpecs.getByProjectId(id);
        const lettering = allLettering.find((l) => l.pageId === page.id);

        const allResults = await repo.panelRenderResults.getByProjectId(id);
        const panelImages: Record<string, string> = {};
        for (const panel of panels) {
          if (panel.renderResultId) {
            const result = allResults.find((r) => r.id === panel.renderResultId);
            if (result) {
              panelImages[panel.id] = `/api/assets/${result.imageKey}`;
            }
          }
        }

        return {
          ...page,
          panels: panels.sort((a, b) => a.index - b.index),
          compositeUrl: composite?.imageKey ? `/api/assets/${composite.imageKey}` : undefined,
          lettering: lettering?.boxes ?? [],
          panelImages,
        };
      }),
    );

    return Response.json({ pages: pagesWithPanels });
  } catch (err) {
    log.error('Failed to list pages', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to list pages' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  try {
    const body = await request.json().catch(() => ({})) as { chapterId?: string };
    const repo = await getRepo();

    // Determine the next page index
    const existing = await repo.pageSpecs.getByProjectId(projectId);
    const index = existing.length > 0 ? Math.max(...existing.map((p) => p.index)) + 1 : 0;

    const page = await repo.pageSpecs.create({
      id: crypto.randomUUID(),
      projectId,
      chapterId: body.chapterId,
      index,
      panelIds: [],
      panelCount: 1,
      readingOrder: [],
      emphasisWeights: {},
      bleedGutter: { bleed: 0, gutter: 0.02 },
      layoutValid: false,
      layoutIssues: [],
    });

    return Response.json({ page }, { status: 201 });
  } catch (err) {
    log.error('Failed to create page', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to create page' }, { status: 500 });
  }
}
