import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { uuid, nowIso, logger, getEnv } from '@audiocomic/shared';
import { createMediaManagerFromEnv } from '@audiocomic/storage';
import { parseChapterTitle } from '@/lib/filename-parser';
import {
  createChapterActor,
  addChapterToProjectActor,
  linkChapterAssetActor,
  startChapterTranscriptionActor,
} from '@/lib/actor-actions';

const log = logger.scoped('upload-batch');

export const dynamic = 'force-dynamic';

// POST /api/projects/[id]/chapters/upload-batch
// Accepts multipart form data with multiple audio files under the `files`
// field (a `files` entry repeated once per file). For each file a new chapter
// is created with a title parsed from the filename, the audio is uploaded to
// MinIO, a SourceAsset is recorded, and transcription is started.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  log.info('batch upload request', { projectId });

  try {
    const formData = await req.formData();
    const entries = formData.getAll('files');
    const files = entries.filter((e): e is File => e instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        { error: 'No audio files provided. Use the `files` field.' },
        { status: 400 },
      );
    }

    const repo = await getRepo();
    const mediaManager = createMediaManagerFromEnv(getEnv());

    // Determine the next available chapter index (max existing index + 1).
    const existing = await repo.chapters.getByProjectId(projectId);
    let nextIndex = existing.reduce((max, c) => (c.index > max ? c.index : max), -1) + 1;

    const created: Array<{
      id: string;
      index: number;
      title: string;
      status: string;
      assetId: string;
      storageKey: string;
    }> = [];

    for (const file of files) {
      const title = parseChapterTitle(file.name);
      const chapterId = uuid();
      const assetId = uuid();
      const now = nowIso();
      const chapterIndex = nextIndex++;

      // 1. Create chapter in DB.
      await repo.chapters.create({
        id: chapterId,
        projectId,
        index: chapterIndex,
        title,
        description: undefined,
        status: 'pending',
        transcriptionStatus: 'pending',
        createdAt: now,
        updatedAt: now,
      });

      // 2. Upload audio to MinIO.
      const storageKey = `projects/${projectId}/chapters/${chapterId}/audio/${file.name}`;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = file.type || 'audio/mpeg';
      log.info('uploading to storage', { storageKey, size: buffer.length, mimeType });
      await mediaManager.upload(storageKey, buffer, mimeType);

      // 3. Create SourceAsset record in DB.
      await repo.sourceAssets.create({
        id: assetId,
        projectId,
        modality: 'audio',
        filename: file.name,
        mimeType,
        sizeBytes: buffer.length,
        storageKey,
        chapterId,
      });

      // 4. Create chapter actor (fire-and-forget).
      createChapterActor(chapterId, projectId, chapterIndex, title).catch((e) =>
        log.error('createChapterActor failed', { chapterId, error: String(e) }),
      );

      // 5. Register chapter with project actor (fire-and-forget).
      addChapterToProjectActor('main', chapterId, title, chapterIndex).catch((e) =>
        log.error('addChapterToProjectActor failed', { chapterId, error: String(e) }),
      );

      // 6. Link asset to chapter actor (fire-and-forget).
      linkChapterAssetActor(chapterId, assetId).catch((e) =>
        log.error('linkChapterAssetActor failed', { chapterId, error: String(e) }),
      );

      // 7. Start transcription (fire-and-forget).
      startChapterTranscriptionActor(chapterId, projectId, chapterIndex).catch((e) =>
        log.error('startChapterTranscriptionActor failed', { chapterId, error: String(e) }),
      );

      // 8. Patch chapter status to `transcribing`.
      await repo.chapters.patch(chapterId, {
        status: 'transcribing',
        transcriptionStatus: 'running',
        sourceAssetId: assetId,
      });

      created.push({ id: chapterId, index: chapterIndex, title, status: 'transcribing', assetId, storageKey });
    }

    log.info('batch upload complete', { projectId, count: created.length });

    return NextResponse.json({ projectId, count: created.length, chapters: created }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('batch upload error', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
