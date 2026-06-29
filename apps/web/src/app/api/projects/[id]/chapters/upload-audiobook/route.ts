import { NextRequest, NextResponse } from 'next/server';
import { getRepo } from '@/lib/db';
import { uuid, nowIso, logger, getEnv, storageKey } from '@audiocomic/shared';
import { createMediaManagerFromEnv } from '@audiocomic/storage';
import { probeChapters, splitAudioChapter, probeAudio } from '@audiocomic/media';
import {
  setupChapterActor,
  addChapterToProjectActor,
} from '@/lib/actor-actions';
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const log = logger.scoped('upload-audiobook');

export const dynamic = 'force-dynamic';

// POST /api/projects/[id]/chapters/upload-audiobook
// Accepts a single audio file (m4b, mp3, etc.) and checks for embedded
// chapter markers via ffprobe. If chapters are found, splits the file
// into per-chapter segments and creates a chapter record for each.
// If no chapters are found, creates a single chapter from the file.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  log.info('audiobook upload request', { projectId });

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file provided. Expected a "file" field in form data.' },
        { status: 400 },
      );
    }

    const repo = await getRepo();
    const mediaManager = createMediaManagerFromEnv(getEnv());
    const env = getEnv();

    // Save the uploaded file to a temp directory for ffprobe/ffmpeg.
    const tmpDir = join(tmpdir(), `audiocomic-audiobook-${uuid()}`);
    await mkdir(tmpDir, { recursive: true });
    const inputPath = join(tmpDir, file.name);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(inputPath, buffer);

    log.info('saved uploaded file', { path: inputPath, size: buffer.length });

    try {
      // Probe for embedded chapters.
      const chapters = await probeChapters(inputPath, env.FFPROBE_BIN);
      log.info('probed chapters', { count: chapters.length });

      // Determine the next available chapter index.
      const existing = await repo.chapters.getByProjectId(projectId);
      let nextIndex = existing.reduce((max, c) => (c.index > max ? c.index : max), -1) + 1;

      if (chapters.length === 0) {
        // No embedded chapters — create a single chapter from the file.
        const title = file.name.replace(/\.[^.]+$/, '');
        const chapterId = uuid();
        const assetId = uuid();
        const now = nowIso();
        const chapterIndex = nextIndex;

        const sKey = storageKey(projectId, 'chapters', `${chapterId}/audio/${file.name}`);
        await mediaManager.upload(sKey, buffer, file.type || 'audio/mpeg');

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

        await repo.sourceAssets.create({
          id: assetId,
          projectId,
          modality: 'audio',
          filename: file.name,
          mimeType: file.type || 'audio/mpeg',
          sizeBytes: buffer.length,
          storageKey: sKey,
          chapterId,
        });

        setupChapterActor(chapterId, projectId, chapterIndex, title, assetId).catch((e) =>
          log.error('setupChapterActor failed', { chapterId, error: String(e) }),
        );
        addChapterToProjectActor('main', chapterId, title, chapterIndex).catch((e) =>
          log.error('addChapterToProjectActor failed', { chapterId, error: String(e) }),
        );

        await repo.chapters.patch(chapterId, {
          status: 'transcribing',
          transcriptionStatus: 'running',
          sourceAssetId: assetId,
        });

        log.info('no embedded chapters, created single chapter', { chapterId, title });
        return NextResponse.json({
          projectId,
          count: 1,
          chapters: [{ id: chapterId, title, index: chapterIndex }],
          detectedChapters: 0,
        }, { status: 201 });
      }

      // Embedded chapters found — split the file and create a chapter per segment.
      const created: Array<{ id: string; title: string; index: number }> = [];

      for (const ch of chapters) {
        const chapterId = uuid();
        const assetId = uuid();
        const now = nowIso();
        const chapterIndex = nextIndex++;
        const chapterFilename = `chapter-${String(ch.id).padStart(3, '0')}.m4a`;

        // Split the chapter using ffmpeg stream copy.
        const chapterPath = join(tmpDir, chapterFilename);
        await splitAudioChapter(
          inputPath,
          chapterPath,
          ch.start,
          ch.duration,
          env.FFMPEG_BIN,
        );

        const chapterBuffer = await readFile(chapterPath);
        const sKey = storageKey(projectId, 'chapters', `${chapterId}/audio/${chapterFilename}`);
        await mediaManager.upload(sKey, chapterBuffer, 'audio/mp4');

        await repo.chapters.create({
          id: chapterId,
          projectId,
          index: chapterIndex,
          title: ch.title,
          description: `Chapter ${ch.id} (start: ${ch.start.toFixed(1)}s, duration: ${ch.duration.toFixed(1)}s)`,
          status: 'pending',
          transcriptionStatus: 'pending',
          createdAt: now,
          updatedAt: now,
        });

        await repo.sourceAssets.create({
          id: assetId,
          projectId,
          modality: 'audio',
          filename: chapterFilename,
          mimeType: 'audio/mp4',
          sizeBytes: chapterBuffer.length,
          storageKey: sKey,
          chapterId,
        });

        setupChapterActor(chapterId, projectId, chapterIndex, ch.title, assetId).catch((e) =>
          log.error('setupChapterActor failed', { chapterId, error: String(e) }),
        );
        addChapterToProjectActor('main', chapterId, ch.title, chapterIndex).catch((e) =>
          log.error('addChapterToProjectActor failed', { chapterId, error: String(e) }),
        );

        await repo.chapters.patch(chapterId, {
          status: 'transcribing',
          transcriptionStatus: 'running',
          sourceAssetId: assetId,
        });

        created.push({ id: chapterId, title: ch.title, index: chapterIndex });
        log.info('created chapter from embedded marker', {
          chapterId,
          title: ch.title,
          start: ch.start,
          duration: ch.duration,
        });
      }

      log.info('audiobook split complete', { projectId, count: created.length });
      return NextResponse.json({
        projectId,
        count: created.length,
        chapters: created,
        detectedChapters: chapters.length,
      }, { status: 201 });
    } finally {
      // Clean up temp directory.
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('audiobook upload error', { projectId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
