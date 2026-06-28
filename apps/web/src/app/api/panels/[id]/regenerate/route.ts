import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';
import { uuid, nowIso } from '@audiocomic/shared';

const log = logger.scoped('api:panel-regen');

// Stub regeneration: creates a job record but does NOT call image API.
// The worker will pick up the job and process it when image gen is enabled.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const repo = await getRepo();
    const panel = await repo.panelSpecs.getById(id);
    if (!panel) {
      return Response.json({ error: 'Panel not found' }, { status: 404 });
    }

    const jobId = uuid();
    await repo.jobs.create({
      id: jobId,
      projectId: panel.projectId,
      type: 'regenerate_panel',
      state: 'pending',
      progress: 0,
      payload: { panelId: id },
      createdAt: nowIso(),
      attempts: 0,
    });

    log.info(`Created regenerate job ${jobId} for panel ${id}`);

    return Response.json({ jobId, panelId: id, status: 'pending' });
  } catch (err) {
    log.error('Failed to create regeneration job', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to create regeneration job' }, { status: 500 });
  }
}
