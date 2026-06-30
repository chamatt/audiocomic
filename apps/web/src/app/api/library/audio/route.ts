import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { logger } from '@audiocomic/shared';

export const dynamic = 'force-dynamic';

const log = logger.scoped('api:library:audio');

// GET /api/library/audio — list all audio source assets across all projects,
// joined with chapter info so the user can pick an already-transcribed chapter
// to import into a new project without re-uploading or re-transcribing.
export async function GET() {
  try {
    const sql = await getSql();
    if (!sql) {
      return NextResponse.json({ error: 'Database not initialized' }, { status: 500 });
    }

    // Join source_assets with chapters to get transcription status and project info.
    const rows = await sql`
      SELECT
        sa.id,
        sa.project_id AS "projectId",
        p.name AS "projectName",
        sa.chapter_id AS "chapterId",
        c.title AS "chapterTitle",
        c.index AS "chapterIndex",
        c.stage,
        c.transcription_status AS "transcriptionStatus",
        sa.filename,
        sa.mime_type AS "mimeType",
        sa.size_bytes AS "sizeBytes",
        sa.duration_sec AS "durationSec",
        sa.storage_key AS "storageKey",
        sa.uploaded_at AS "uploadedAt"
      FROM source_assets sa
      LEFT JOIN projects p ON p.id = sa.project_id
      LEFT JOIN chapters c ON c.id = sa.chapter_id
      WHERE sa.modality = 'audio'
      ORDER BY sa.uploaded_at DESC
    `;

    return NextResponse.json({ assets: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('failed to list library audio', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
