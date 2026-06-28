import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { getStorageManager } from '@/lib/storage';
import { linkChapterAssetActor, startChapterTranscriptionActor } from '@/lib/actor-actions';
import { uuid, nowIso, logger } from '@audiocomic/shared';

const log = logger.scoped('upload');

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;
  log.info('upload request', { chapterId });

  try {
    const formData = await req.formData();
    const file = formData.get('audio');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    const repo = await getRepo();
    const chapter = await repo.chapters.getById(chapterId);
    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    // 1. Upload file to MediaManager (S3/MinIO or local)
    const storageKey = `projects/${chapter.projectId}/chapters/${chapterId}/audio/${file.name}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || 'audio/mpeg';
    log.info('uploading to storage', { storageKey, size: buffer.length, mimeType });

    const mediaManager = getStorageManager();
    await mediaManager.upload(storageKey, buffer, mimeType);
    log.info('storage upload complete', { storageKey });

    // 2. Create SourceAsset record in DB
    const assetId = uuid();
    const now = nowIso();
    await repo.sourceAssets.create({
      id: assetId,
      projectId: chapter.projectId,
      modality: 'audio',
      filename: file.name,
      mimeType,
      sizeBytes: buffer.length,
      storageKey,
      chapterId,
    });

    // 3. Link asset to chapter actor (fire-and-forget)
    linkChapterAssetActor(chapterId, assetId).catch((e) => log.error('linkChapterAssetActor failed', { chapterId, error: String(e) }));

    // 4. Start transcription automatically (fire-and-forget)
    startChapterTranscriptionActor(chapterId, chapter.projectId, chapter.index).catch((e) => log.error('startChapterTranscriptionActor failed', { chapterId, error: String(e) }));
    // 5. Update chapter status in DB
    await repo.chapters.patch(chapterId, {
      status: 'transcribing',
      transcriptionStatus: 'running',
      sourceAssetId: assetId,
    });

    return NextResponse.json({
      chapterId,
      assetId,
      storageKey,
      status: 'transcribing',
      message: 'Audio uploaded. Transcription started automatically.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('chapter upload error:', msg, e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
