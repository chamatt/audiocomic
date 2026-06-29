import { NextResponse, type NextRequest } from 'next/server';
import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:project:export');

// GET /api/projects/[id]/export
// Returns export status: which chapters have rendered panels, and lists
// any existing export bundles grouped by chapter.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  try {
    const repo = await getRepo();

    const chapters = await repo.chapters.getByProjectId(projectId);
    const allBundles = await repo.exportBundles.getByProjectId(projectId);

    const chaptersWithExports = chapters.map((ch) => {
      const exports = allBundles
        .filter((b) => b.metadata?.chapterId === ch.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        id: ch.id,
        title: ch.title,
        stage: ch.stage,
        exportCount: exports.length,
        latestExport: exports[0]
          ? {
              id: exports[0].id,
              mp4Url: `/api/assets/${exports[0].storageKey}`,
              createdAt: exports[0].createdAt,
              sizeBytes: exports[0].sizeBytes ?? 0,
              durationSec: (exports[0].metadata?.durationSec as number) ?? 0,
            }
          : null,
      };
    });

    return NextResponse.json({ projectId, chapters: chaptersWithExports });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('export status failed', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
