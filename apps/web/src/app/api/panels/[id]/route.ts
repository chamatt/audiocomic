import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';
import type { PanelSpec } from '@audiocomic/domain';

const log = logger.scoped('api:panel-update');

// Editable fields on a panel
const EDITABLE_FIELDS = [
  'description',
  'renderPrompt',
  'renderNegativePrompt',
  'cameraFraming',
  'dialogueLines',
  'characters',
  'qaStatus',
  'qaNotes',
  'seed',
  'zIndex',
  'index',
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

function isEditableField(key: string): key is EditableField {
  return (EDITABLE_FIELDS as readonly string[]).includes(key);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const repo = await getRepo();

    const existing = await repo.panelSpecs.getById(id);
    if (!existing) {
      return Response.json({ error: 'Panel not found' }, { status: 404 });
    }

    // Build patch from only editable fields
    const patch: Partial<PanelSpec> = {};
    for (const [key, value] of Object.entries(body)) {
      if (isEditableField(key) && value !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (patch as Record<string, unknown>)[key] = value;
      }
    }

    if (Object.keys(patch).length === 0) {
      return Response.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await repo.panelSpecs.patch(id, patch);
    if (!updated) {
      return Response.json({ error: 'Failed to update panel' }, { status: 500 });
    }

    return Response.json({ panel: updated });
  } catch (err) {
    log.error('Failed to update panel', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Failed to update panel' }, { status: 500 });
  }
}
