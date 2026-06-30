import { NextRequest, NextResponse } from 'next/server';
import { getRepo, getSql } from '@/lib/db';
import { uuid, nowIso, logger } from '@audiocomic/shared';
import {
  initChapterActor,
  addChapterToProjectActor,
} from '@/lib/actor-actions';

export const dynamic = 'force-dynamic';

const log = logger.scoped('api:project:import-chapter');

// POST /api/projects/[id]/import-chapter
// Import a chapter from another project: copies the audio asset reference,
// transcript, KB (story sections, characters, world bible, knowledge pages,
// knowledge embeddings, character states, chapter ingest log), and plans
// (pages, panel specs) — but NOT render results, render requests, page
// composites, lettering, narration timelines, or export bundles.
//
// Body: { sourceChapterId: string }
//
// The source chapter's audio file is NOT re-uploaded — the new SourceAsset
// points to the same storage key. Transcription is NOT re-run — transcript
// chunks and KB data are copied directly.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: targetProjectId } = await params;
  const body = await req.json();
  const { sourceChapterId } = body as { sourceChapterId: string };

  if (!sourceChapterId) {
    return NextResponse.json(
      { error: 'sourceChapterId is required' },
      { status: 400 },
    );
  }

  try {
    const repo = await getRepo();
    const sql = await getSql();
    if (!sql) {
      return NextResponse.json(
        { error: 'Database not initialized' },
        { status: 500 },
      );
    }

    // ── Load source chapter ──
    const sourceChapter = await repo.chapters.getById(sourceChapterId);
    if (!sourceChapter) {
      return NextResponse.json(
        { error: 'Source chapter not found' },
        { status: 404 },
      );
    }
    const sourceProjectId = sourceChapter.projectId;

    // ── Determine target chapter index ──
    const existingChapters = await repo.chapters.getByProjectId(targetProjectId);
    const targetIndex = existingChapters.reduce(
      (max, c) => (c.index > max ? c.index : max),
      -1,
    ) + 1;

    const targetChapterId = uuid();
    const now = nowIso();

    // ── 1. Create target chapter ──
    await repo.chapters.create({
      id: targetChapterId,
      projectId: targetProjectId,
      index: targetIndex,
      title: sourceChapter.title,
      description: sourceChapter.description,
      status: 'ready_for_review',
      stage: 'ready_for_review',
      transcriptionStatus: 'done',
      durationSec: sourceChapter.durationSec,
      createdAt: now,
      updatedAt: now,
    });

    // ── 2. Copy source asset (reference same storage key, no re-upload) ──
    let sourceAssetId: string | undefined;
    const sourceAssets = await repo.sourceAssets.getByProjectId(sourceProjectId);
    const sourceAsset = sourceAssets.find(
      (a) => a.chapterId === sourceChapterId,
    );
    if (sourceAsset) {
      sourceAssetId = uuid();
      await repo.sourceAssets.create({
        id: sourceAssetId,
        projectId: targetProjectId,
        modality: sourceAsset.modality,
        filename: sourceAsset.filename,
        mimeType: sourceAsset.mimeType,
        sizeBytes: sourceAsset.sizeBytes,
        storageKey: sourceAsset.storageKey, // same key — no re-upload
        durationSec: sourceAsset.durationSec,
        checksum: sourceAsset.checksum,
        chapterId: targetChapterId,
        uploadedAt: now,
      });
      // Link asset to chapter
      await repo.chapters.patch(targetChapterId, { sourceAssetId });
    }

    // ── 3. Copy transcript chunks ──
    const sourceTranscript = await sql`
      SELECT index, text, start_sec, end_sec, speaker, word_count
      FROM transcript_chunks
      WHERE project_id = ${sourceProjectId}
      AND chapter_id = ${sourceChapterId}
      ORDER BY index
    `;
    if (sourceTranscript.length > 0) {
      await sql`
        INSERT INTO transcript_chunks
          (id, project_id, chapter_id, index, text, start_sec, end_sec, speaker, word_count)
        SELECT
          gen_random_uuid(), ${targetProjectId}, ${targetChapterId},
          index, text, start_sec, end_sec, speaker, word_count
        FROM (VALUES ${sql(sourceTranscript.map((r: any) => [
          r.index, r.text, r.start_sec, r.end_sec, r.speaker, r.word_count,
        ]))}) AS t(index, text, start_sec, end_sec, speaker, word_count)
      `;
    }

    // ── 4. Copy speaker turns ──
    const sourceTurns = await sql`
      SELECT index, speaker, start_sec, end_sec, text
      FROM speaker_turns
      WHERE project_id = ${sourceProjectId}
      AND chapter_id = ${sourceChapterId}
      ORDER BY index
    `;
    if (sourceTurns.length > 0) {
      await sql`
        INSERT INTO speaker_turns
          (id, project_id, chapter_id, index, speaker, start_sec, end_sec, text)
        SELECT
          gen_random_uuid(), ${targetProjectId}, ${targetChapterId},
          index, speaker, start_sec, end_sec, text
        FROM (VALUES ${sql(sourceTurns.map((r: any) => [
          r.index, r.speaker, r.start_sec, r.end_sec, r.text,
        ]))}) AS t(index, speaker, start_sec, end_sec, text)
      `;
    }

    // ── 5. Copy world bible (if target project doesn't have one yet) ──
    const targetWorldBibles = await repo.worldBibles.getByProjectId(targetProjectId);
    if (targetWorldBibles.length === 0) {
      const sourceWorldBibles = await repo.worldBibles.getByProjectId(sourceProjectId);
      if (sourceWorldBibles.length > 0) {
        const wb = sourceWorldBibles[0]!;
        await repo.worldBibles.create({
          id: uuid(),
          projectId: targetProjectId,
          setting: wb.setting,
          artStyle: wb.artStyle,
          artStyleNegative: wb.artStyleNegative,
          colorPalette: wb.colorPalette,
          tone: wb.tone,
        });
      }
    }

    // ── 6. Copy character profiles (skip duplicates by name) ──
    const sourceChars = await repo.characterProfiles.getByProjectId(sourceProjectId);
    const targetChars = await repo.characterProfiles.getByProjectId(targetProjectId);
    const targetCharNames = new Set(targetChars.map((c) => c.name));
    const charIdMap = new Map<string, string>(); // source ID → target ID

    for (const char of sourceChars) {
      if (targetCharNames.has(char.name)) {
        // Map to existing character with same name
        const existing = targetChars.find((c) => c.name === char.name)!;
        charIdMap.set(char.id, existing.id);
        continue;
      }
      const newCharId = uuid();
      charIdMap.set(char.id, newCharId);
      await repo.characterProfiles.create({
        id: newCharId,
        projectId: targetProjectId,
        name: char.name,
        description: char.description,
        paletteNotes: char.paletteNotes,
        negativeConstraints: char.negativeConstraints,
        canonicalFaceRef: char.canonicalFaceRef,
        outfitRefs: char.outfitRefs,
      });
    }

    // ── 7. Copy scene profiles ──
    const sourceScenes = await repo.sceneProfiles.getByProjectId(sourceProjectId);
    const sceneIdMap = new Map<string, string>();
    for (const scene of sourceScenes) {
      const newSceneId = uuid();
      sceneIdMap.set(scene.id, newSceneId);
      await repo.sceneProfiles.create({
        id: newSceneId,
        projectId: targetProjectId,
        name: scene.name,
        description: scene.description,
        locationType: scene.locationType,
        timeOfDay: scene.timeOfDay,
        weather: scene.weather,
        paletteNotes: scene.paletteNotes,
        referenceImageKey: scene.referenceImageKey,
        embeddingKey: scene.embeddingKey,
      });
    }

    // ── 8. Copy object profiles ──
    const sourceObjects = await repo.objectProfiles.getByProjectId(sourceProjectId);
    for (const obj of sourceObjects) {
      await repo.objectProfiles.create({
        id: uuid(),
        projectId: targetProjectId,
        name: obj.name,
        description: obj.description,
        referenceImageKey: obj.referenceImageKey,
        firstAppearanceSectionId: obj.firstAppearanceSectionId,
      });
    }
    // ── 9. Copy story sections (with parent ID remapping) ──
    const sourceSections = await sql`
      SELECT id, parent_id, level, index, title, summary, text,
             start_sec, end_sec, word_start_index, word_end_index,
             characters_present, scene_id, emotional_tone, camera_hint, objects,
             embedding_key, embedding
      FROM story_sections
      WHERE project_id = ${sourceProjectId}
      AND chapter_id = ${sourceChapterId}
      ORDER BY level, index
    `;

    const sectionIdMap = new Map<string, string>();
    // First pass: assign new IDs
    for (const row of sourceSections as any[]) {
      sectionIdMap.set(row.id, uuid());
    }
    // Second pass: insert with remapped parent_id and scene_id
    for (const row of sourceSections as any[]) {
      const newId = sectionIdMap.get(row.id)!;
      const newParentId = row.parent_id ? sectionIdMap.get(row.parent_id) ?? null : null;
      const newSceneId = row.scene_id ? sceneIdMap.get(row.scene_id) ?? null : null;
      // Remap character IDs in characters_present
      const remappedChars = (row.characters_present || []).map(
        (id: string) => charIdMap.get(id) ?? id,
      );

      await sql`
        INSERT INTO story_sections
          (id, project_id, chapter_id, parent_id, level, index, title, summary, text,
           start_sec, end_sec, word_start_index, word_end_index,
           characters_present, scene_id, emotional_tone, camera_hint, objects,
           embedding_key, embedding)
        VALUES
          (${newId}, ${targetProjectId}, ${targetChapterId}, ${newParentId}, ${row.level}, ${row.index},
           ${row.title}, ${row.summary}, ${row.text},
           ${row.start_sec}, ${row.end_sec}, ${row.word_start_index}, ${row.word_end_index},
           ${JSON.stringify(remappedChars)}::jsonb, ${newSceneId}, ${row.emotional_tone},
           ${row.camera_hint}, ${JSON.stringify(row.objects)}::jsonb,
           ${row.embedding_key}, ${row.embedding})
      `;
    }

    // ── 10. Copy knowledge pages ──
    const sourceKnowledge = await sql`
      SELECT type, title, content, references, cross_references, confidence
      FROM knowledge_pages
      WHERE project_id = ${sourceProjectId}
    `;
    for (const row of sourceKnowledge as any[]) {
      await sql`
        INSERT INTO knowledge_pages
          (id, project_id, type, title, content, references, cross_references, confidence)
        VALUES
          (gen_random_uuid(), ${targetProjectId}, ${row.type}, ${row.title}, ${row.content},
           ${JSON.stringify(row.references)}::jsonb, ${JSON.stringify(row.cross_references)}::jsonb,
           ${row.confidence})
      `;
    }

    // ── 11. Copy knowledge embeddings ──
    const sourceEmbeddings = await sql`
      SELECT chunk_index, text, metadata, embedding
      FROM knowledge_embeddings
      WHERE project_id = ${sourceProjectId}
      AND chapter_id = ${sourceChapterId}
    `;
    for (const row of sourceEmbeddings as any[]) {
      await sql`
        INSERT INTO knowledge_embeddings
          (id, project_id, chapter_id, chunk_index, text, metadata, embedding)
        VALUES
          (gen_random_uuid(), ${targetProjectId}, ${targetChapterId},
           ${row.chunk_index}, ${row.text}, ${JSON.stringify(row.metadata)}::jsonb,
           ${row.embedding})
      `;
    }

    // ── 12. Copy character states (remap character + chapter IDs) ──
    const sourceStates = await sql`
      SELECT character_id, chapter_index, outfit, location, mood, relationships, notes, provenance
      FROM character_states
      WHERE project_id = ${sourceProjectId}
      AND chapter_id = ${sourceChapterId}
    `;
    for (const row of sourceStates as any[]) {
      const newCharId = charIdMap.get(row.character_id);
      if (!newCharId) continue;
      await sql`
        INSERT INTO character_states
          (id, project_id, character_id, chapter_id, chapter_index,
           outfit, location, mood, relationships, notes, provenance)
        VALUES
          (gen_random_uuid(), ${targetProjectId}, ${newCharId}, ${targetChapterId},
           ${row.chapter_index}, ${row.outfit}, ${row.location}, ${row.mood},
           ${JSON.stringify(row.relationships)}::jsonb, ${row.notes}, ${row.provenance})
      `;
    }

    // ── 13. Copy chapter ingest log ──
    const sourceIngestLog = await sql`
      SELECT embeddings_count, wiki_pages_count
      FROM chapter_ingest_log
      WHERE chapter_id = ${sourceChapterId}
    `;
    if (sourceIngestLog.length > 0) {
      const row = sourceIngestLog[0] as any;
      await sql`
        INSERT INTO chapter_ingest_log
          (chapter_id, project_id, embeddings_count, wiki_pages_count)
        VALUES
          (${targetChapterId}, ${targetProjectId}, ${row.embeddings_count}, ${row.wiki_pages_count})
      `;
    }

    // ── 14. Copy pages and panel specs (NO render results) ──
    const sourcePages = await sql`
      SELECT id, index, story_section_id, panel_ids, panel_count,
             reading_order, emphasis_weights, bleed_gutter, layout_valid, layout_issues
      FROM page_specs
      WHERE project_id = ${sourceProjectId}
      AND chapter_id = ${sourceChapterId}
      ORDER BY index
    `;

    const pageIdMap = new Map<string, string>();

    for (const pageRow of sourcePages as any[]) {
      const newPageId = uuid();
      pageIdMap.set(pageRow.id, newPageId);

      // Remap story_section_id
      const newStorySectionId = pageRow.story_section_id
        ? sectionIdMap.get(pageRow.story_section_id) ?? null
        : null;

      // We'll fill panel_ids and reading_order after creating panels
      await sql`
        INSERT INTO page_specs
          (id, project_id, chapter_id, index, story_section_id, panel_ids, panel_count,
           reading_order, emphasis_weights, bleed_gutter, layout_valid, layout_issues)
        VALUES
          (${newPageId}, ${targetProjectId}, ${targetChapterId}, ${pageRow.index},
           ${newStorySectionId}, '[]'::jsonb, ${pageRow.panel_count},
           '[]'::jsonb, ${JSON.stringify(pageRow.emphasis_weights)}::jsonb,
           ${JSON.stringify(pageRow.bleed_gutter)}::jsonb,
           ${pageRow.layout_valid}, ${JSON.stringify(pageRow.layout_issues)}::jsonb)
      `;

      // Copy panels for this page
      const sourcePanels = await sql`
        SELECT index, story_section_id, bbox, z_index, description,
               camera_framing, characters, dialogue_lines, start_sec, end_sec,
               render_prompt, render_negative_prompt, render_preset_id, seed,
               qa_status, qa_notes
        FROM panel_specs
        WHERE page_id = ${pageRow.id}
        ORDER BY index
      `;

      const newPanelIds: string[] = [];
      for (const panelRow of sourcePanels as any[]) {
        const newPanelId = uuid();
        newPanelIds.push(newPanelId);

        const newPanelStorySectionId = panelRow.story_section_id
          ? sectionIdMap.get(panelRow.story_section_id) ?? null
          : null;

        // Remap character IDs in panel.characters
        const remappedPanelChars = (panelRow.characters || []).map((c: any) => ({
          ...c,
          characterId: charIdMap.get(c.characterId) ?? c.characterId,
        }));

        await sql`
          INSERT INTO panel_specs
            (id, page_id, project_id, chapter_id, index, story_section_id,
             bbox, z_index, description, camera_framing, characters, dialogue_lines,
             start_sec, end_sec, render_prompt, render_negative_prompt,
             render_preset_id, seed, qa_status, qa_notes)
          VALUES
            (${newPanelId}, ${newPageId}, ${targetProjectId}, ${targetChapterId},
             ${panelRow.index}, ${newPanelStorySectionId},
             ${JSON.stringify(panelRow.bbox)}::jsonb, ${panelRow.z_index},
             ${panelRow.description}, ${panelRow.camera_framing},
             ${JSON.stringify(remappedPanelChars)}::jsonb,
             ${JSON.stringify(panelRow.dialogue_lines)}::jsonb,
             ${panelRow.start_sec}, ${panelRow.end_sec},
             ${panelRow.render_prompt}, ${panelRow.render_negative_prompt},
             ${panelRow.render_preset_id}, ${panelRow.seed},
             ${panelRow.qa_status}, ${panelRow.qa_notes})
        `;
      }

      // Update page with remapped panel_ids and reading_order
      await sql`
        UPDATE page_specs
        SET panel_ids = ${JSON.stringify(newPanelIds)}::jsonb,
            reading_order = ${JSON.stringify(newPanelIds)}::jsonb
        WHERE id = ${newPageId}
      `;
    }

    // ── 15. Initialize chapter actor (Init + Title + LinkAsset, NO transcription) ──
    // The imported chapter already has transcript + KB + plans copied.
    if (sourceAssetId) {
      initChapterActor(
        targetChapterId,
        targetProjectId,
        targetIndex,
        sourceChapter.title,
        sourceAssetId,
      ).catch((e) =>
        log.error('initChapterActor failed', {
          chapterId: targetChapterId,
          error: String(e),
        }),
      );
    }

    addChapterToProjectActor(
      'main',
      targetChapterId,
      sourceChapter.title,
      targetIndex,
    ).catch((e) =>
      log.error('addChapterToProjectActor failed', {
        chapterId: targetChapterId,
        error: String(e),
      }),
    );

    log.info('chapter imported', {
      sourceChapterId,
      sourceProjectId,
      targetChapterId,
      targetProjectId,
      sectionsCopied: sourceSections.length,
      pagesCopied: sourcePages.length,
    });

    return NextResponse.json(
      {
        chapterId: targetChapterId,
        sourceChapterId,
        sourceProjectId,
        title: sourceChapter.title,
        index: targetIndex,
        status: 'ready_for_review',
        copied: {
          transcriptChunks: sourceTranscript.length,
          speakerTurns: sourceTurns.length,
          storySections: sourceSections.length,
          knowledgePages: sourceKnowledge.length,
          knowledgeEmbeddings: sourceEmbeddings.length,
          characterStates: sourceStates.length,
          pages: sourcePages.length,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('import-chapter failed', {
      targetProjectId,
      sourceChapterId,
      error: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
