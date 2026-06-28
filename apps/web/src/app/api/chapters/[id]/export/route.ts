import { NextResponse, type NextRequest } from 'next/server';
import { getRepo } from '@/lib/db';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:chapter:export');

// POST /api/chapters/[id]/export — export a single chapter.
// Body: { type: "static" | "motion" }
// Static: bundles composed page images + lettering as a ZIP.
// Motion: renders MP4 with ken-burns per panel + original audio narration.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;
  try {
    const body = await req.json() as { type?: string };
    const type = body.type === 'motion' ? 'motion' : 'static';

    const repo = await getRepo();
    const chapter = await repo.chapters.getById(chapterId);
    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    if (chapter.stage !== 'done') {
      return NextResponse.json(
        { error: `Chapter must be at done stage (current: ${chapter.stage})` },
        { status: 400 },
      );
    }

    // Get all pages for this chapter.
    const allPages = await repo.pageSpecs.getByProjectId(chapter.projectId);
    const chapterPages = allPages.filter((p) => p.chapterId === chapterId);

    if (chapterPages.length === 0) {
      return NextResponse.json({ error: 'No pages found for this chapter' }, { status: 400 });
    }

    // Get composites for these pages.
    const allComposites = await repo.pageComposites.getByProjectId(chapter.projectId);
    const pageImageKeys: string[] = [];
    for (const page of chapterPages) {
      const composite = allComposites.find((c) => c.pageId === page.id);
      if (composite?.imageKey) {
        pageImageKeys.push(composite.imageKey);
      }
    }

    if (pageImageKeys.length === 0) {
      return NextResponse.json({ error: 'No composed page images found' }, { status: 400 });
    }

    // For static export, return the list of image keys for client-side download.
    // For motion export, we'd need the media adapter — deferred to worker job.
    if (type === 'motion') {
      // Create a job for the worker to process.
      const job = await repo.jobs.create({
        id: crypto.randomUUID(),
        projectId: chapter.projectId,
        type: 'export_chapter',
        state: 'pending',
        progress: 0,
        payload: { chapterId, type: 'motion', pageImageKeys },
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({
        chapterId,
        type: 'motion',
        jobId: job.id,
        status: 'pending',
        message: 'Motion export job created. Check job status for progress.',
      });
    }

    // Static: return image URLs for direct download.
    return NextResponse.json({
      chapterId,
      type: 'static',
      pages: pageImageKeys.map((key) => `/api/assets/${key}`),
      count: pageImageKeys.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('export route failed', { chapterId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
