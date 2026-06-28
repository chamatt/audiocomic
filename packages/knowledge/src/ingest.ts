// Chapter transcription ingestion into the knowledge base.
//
// Loads the transcript chunks for a project, filters to a single chapter,
// re-chunks them into RAG-sized segments, embeds each segment, and persists
// the embeddings into the `knowledge_embeddings` table via the Repository.
//
// Note: `repo.setEmbedding` only supports the story/character/scene/object/
// world tables — it does *not* cover `transcript_chunks`. We therefore store
// chapter knowledge vectors exclusively in `knowledge_embeddings` and leave
// the transcript_chunks.embedding column untouched.

import type { Repository } from '@audiocomic/db';
import type { TranscriptChunk } from '@audiocomic/domain';

import { chunkTranscription } from './chunking';
import type { EmbeddingProvider } from './types';

export interface IngestResult {
  chunkCount: number;
  embeddingCount: number;
}

/**
 * Ingest a single chapter's transcription into the knowledge base.
 *
 * @returns `{ chunkCount, embeddingCount }` — the number of RAG segments
 *   produced and the number of rows written to `knowledge_embeddings`
 *   (equal unless a write fails).
 */
export async function ingestChapterTranscription(
  repo: Repository,
  embedder: EmbeddingProvider,
  projectId: string,
  chapterId: string,
): Promise<IngestResult> {
  const allChunks = await repo.transcriptChunks.getByProjectId(projectId);

  // Filter to the target chapter. Chunks without a chapterId are excluded —
  // a chapter-scoped ingest must not pull in unattributed transcript text.
  const chapterChunks: TranscriptChunk[] = allChunks.filter(
    (c) => c.chapterId === chapterId,
  );

  if (chapterChunks.length === 0) {
    return { chunkCount: 0, embeddingCount: 0 };
  }

  // Re-chunk into ~512-token segments with 50-token overlap.
  const segments = chunkTranscription(
    chapterChunks.map((c) => ({
      text: c.text,
      start: c.start,
      end: c.end,
      speaker: c.speaker,
    })),
    chapterId,
  );

  if (segments.length === 0) {
    return { chunkCount: 0, embeddingCount: 0 };
  }

  // Embed all segments in one batched call (the provider handles API limits).
  const texts = segments.map((s) => s.text);
  const vectors = await embedder.embedMany(texts);

  if (vectors.length !== segments.length) {
    throw new Error(
      `ingestChapterTranscription: embedder returned ${vectors.length} vectors for ${segments.length} segments`,
    );
  }

  // Persist each segment + embedding. We write sequentially to keep memory
  // bounded; the per-project ingest volume is small (one chapter's worth).
  let embeddingCount = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const embedding = vectors[i]!;
    await repo.knowledgeEmbeddings.create({
      projectId,
      chapterId,
      chunkIndex: seg.metadata.chunkIndex,
      text: seg.text,
      metadata: {
        chapterId: seg.metadata.chapterId,
        chunkIndex: seg.metadata.chunkIndex,
        startSec: seg.metadata.startSec,
        endSec: seg.metadata.endSec,
        speaker: seg.metadata.speaker,
      },
      embedding,
    });
    embeddingCount++;
  }

  return { chunkCount: segments.length, embeddingCount };
}
