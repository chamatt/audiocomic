import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:panel-renders');

// GET /api/panels/[id]/renders — list all render results for a panel,
// ordered by creation time (newest first). Each result includes the
// image URL so the storyboard can show previous generations.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: panelId } = await params;
  try {
    const repo = await getRepo();
    const panel = await repo.panelSpecs.getById(panelId);
    if (!panel) {
      return Response.json({ error: 'Panel not found' }, { status: 404 });
    }

    const allResults = await repo.panelRenderResults.getByProjectId(panel.projectId);
    const panelResults = allResults
      .filter((r) => r.panelId === panelId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({
        id: r.id,
        imageKey: r.imageKey,
        imageUrl: `/api/assets/${r.imageKey}`,
        seed: r.seed,
        modelUsed: r.modelUsed,
        backend: r.backend,
        createdAt: r.createdAt,
        accepted: r.accepted,
      }));

    return Response.json({ renders: panelResults });
  } catch (err) {
    log.error('Failed to list panel renders', {
      panelId,
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to list renders' }, { status: 500 });
  }
}
