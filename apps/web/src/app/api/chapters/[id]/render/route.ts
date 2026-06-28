import { NextResponse, type NextRequest } from 'next/server';
import { getRepo } from '@/lib/db';
import { startChapterRenderActor } from '@/lib/actor-actions';
import { logger } from '@audiocomic/shared';

const log = logger.scoped('api:chapter:render');

// POST /api/chapters/[id]/render — trigger panel rendering for a single chapter.
// The ChapterActor's StartRender action renders all unrendered panels for this
// chapter and auto-advances to compose (pages + lettering) → done.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;
  try {
    const repo = await getRepo();
    const chapter = await repo.chapters.getById(chapterId);
    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    // Only allow render from ready_for_review stage.
    if (chapter.stage !== 'ready_for_review' && chapter.stage !== 'failed') {
      return NextResponse.json(
        { error: `Chapter must be at ready_for_review stage (current: ${chapter.stage})` },
        { status: 400 },
      );
    }

    // Start the render fiber in the ChapterActor.
    const result = await startChapterRenderActor(chapterId);
    if (!result.ok) {
      log.error('render actor failed', { chapterId, error: result.error });
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      chapterId,
      status: 'rendering',
      message: 'Panel rendering started. Will auto-advance to compose → done.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('render route failed', { chapterId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
