import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { getStorageManager } from '@/lib/storage';
import { linkChapterAssetActor, startChapterTranscriptionActor } from '@/lib/actor-actions';
import { uuid, nowIso } from '@audiocomic/shared';

export const dynamic = 'force-dynamic';

// POST /api/chapters/[id]/upload — upload audio for a chapter
// Accepts multipart form data with a single file field "audio"
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;

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

  const mediaManager = getStorageManager();
  await mediaManager.upload(storageKey, buffer, mimeType);

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
    uploadedAt: now,
  });


  // 4. Link asset to chapter actor (fire-and-forget)
  linkChapterAssetActor(chapterId, assetId).catch(() => {});

  // 5. Start transcription automatically (fire-and-forget)
  startChapterTranscriptionActor(chapterId).catch(() => {});

  // 6. Update chapter status in DB
  await repo.chapters.patch(chapterId, {
    status: 'transcribing',
    transcriptionStatus: 'running',
    sourceAssetId: assetId,
    updatedAt: now,
  });

  return NextResponse.json({
    chapterId,
    assetId,
    storageKey,
    status: 'transcribing',
    message: 'Audio uploaded. Transcription started automatically.',
  });
}
