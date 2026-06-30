import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { logger } from '@audiocomic/shared';

export const dynamic = 'force-dynamic';

const log = logger.scoped('api:library:chapters');

// GET /api/library/chapters — list all chapters across all projects with
// their plan/KB status, so the user can pick a chapter to import into a
// new project (reusing transcription, KB, and plans without re-running).
export async function GET() {
  try {
    const sql = await getSql();
    if (!sql) {
      return NextResponse.json({ error: 'Database not initialized' }, { status: 500 });
    }

    const rows = await sql`
      SELECT
        c.id,
        c.project_id AS "projectId",
        p.name AS "projectName",
        c.title,
        c.index,
        c.stage,
        c.transcription_status AS "transcriptionStatus",
        c.duration_sec AS "durationSec",
        c.created_at AS "createdAt",
        (SELECT count(*) FROM story_sections s WHERE s.project_id = c.project_id AND s.chapter_id = c.id) AS "sectionCount",
        (SELECT count(*) FROM page_specs pg WHERE pg.project_id = c.project_id AND pg.chapter_id = c.id) AS "pageCount",
        (SELECT count(*) FROM panel_specs ps WHERE ps.project_id = c.project_id AND ps.chapter_id = c.id) AS "panelCount",
        (SELECT count(*) FROM panel_specs ps WHERE ps.project_id = c.project_id AND ps.chapter_id = c.id AND ps.render_result_id IS NOT NULL) AS "renderedPanelCount"
      FROM chapters c
      LEFT JOIN projects p ON p.id = c.project_id
      ORDER BY c.created_at DESC
    `;

    return NextResponse.json({ chapters: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('failed to list library chapters', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
