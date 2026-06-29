// Vector search over the knowledge base and story sections.
//
// `searchKnowledgeBase` embeds the query and runs a pgvector cosine distance
// query against `knowledge_embeddings` (transcript chunks) via Drizzle's
// `db.execute`. `searchStorySections` does the same against `story_sections`
// (structured plan data) to retrieve MangaFlow-style section memory from
// previously planned chapters. The Repository does not expose raw SQL for
// these tables, so callers pass the `Db` instance from `createDb()` directly.

import { sql } from 'drizzle-orm';
import type { Db } from '@audiocomic/db';

import type { EmbeddingProvider, SearchResult } from './types';

/** Default number of hits to return. */
const DEFAULT_TOP_K = 5;

/** Row shape returned by the raw query (snake_case from postgres). */
interface KnowledgeEmbeddingRow {
  id: string;
  text: string;
  metadata: Record<string, unknown> | null;
  distance: number;
}

/**
 * Search the knowledge base for the top-K most similar segments to `query`.
 *
 * Uses pgvector's `<=>` (cosine distance) operator. `score` is converted to a
 * similarity in `[0, 1]` via `1 - distance` so higher is more relevant.
 *
 * @param db    Drizzle instance from `createDb()` (used for raw SQL access).
 * @param embedder Provider matching the dimensionality stored in the DB.
 * @param projectId Scope the search to a single project.
 * @param query  Natural-language query string.
 * @param topK  Max results (default 5).
 */
export async function searchKnowledgeBase(
  db: Db,
  embedder: EmbeddingProvider,
  projectId: string,
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<SearchResult[]> {
  if (topK <= 0) return [];

  const queryVector = await embedder.embed(query);

  // pgvector accepts the `[1,2,3]` literal form; drizzle's `sql` helper
  // parameterises the array as a string, so we build the vector literal
  // explicitly. The embedding is a trusted output of our own provider, so
  // serialising it into the SQL string is safe (numbers only).
  const vectorLiteral = `[${queryVector.join(',')}]`;

  const result = await db.execute(sql`
    SELECT id, text, metadata, embedding <=> ${vectorLiteral}::vector AS distance
    FROM knowledge_embeddings
    WHERE project_id = ${projectId}
    ORDER BY distance
    LIMIT ${topK}
  `);

  const rows = result as unknown as KnowledgeEmbeddingRow[];
  return rows.map((row) => ({
    text: row.text,
    score: 1 - Number(row.distance),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Story section search — retrieves structured plan data from previously
// planned chapters via embedding similarity on `story_sections.embedding`.
// ---------------------------------------------------------------------------

/** Row shape returned by the story_sections vector query. */
interface StorySectionEmbeddingRow {
  id: string;
  level: string;
  title: string | null;
  summary: string;
  emotional_tone: string | null;
  characters_present: unknown[] | null;
  objects: unknown[] | null;
  parent_id: string | null;
  distance: number;
}

export interface StorySectionSearchResult {
  id: string;
  level: string;
  title: string | null;
  summary: string;
  emotionalTone: string | null;
  charactersPresent: string[];
  objects: string[];
  parentId: string | null;
  score: number;
}

/**
 * Search previously planned story sections by embedding similarity.
 *
 * Queries the `story_sections.embedding` column (populated by the
 * `plan_chapters` step via `buildSectionMemory`). Returns structured
 * section data — chapter/scene/beat hierarchy, emotional tone, characters —
 * so the planner agent can maintain cross-chapter continuity without
 * re-reading raw transcripts.
 *
 * @param db    Drizzle instance from `createDb()`.
 * @param embedder Provider matching the dimensionality stored in the DB.
 * @param projectId Scope the search to a single project.
 * @param query  Natural-language query (e.g. "character X meets character Y").
 * @param topK  Max results (default 5).
 */
export async function searchStorySections(
  db: Db,
  embedder: EmbeddingProvider,
  projectId: string,
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<StorySectionSearchResult[]> {
  if (topK <= 0) return [];

  const queryVector = await embedder.embed(query);
  const vectorLiteral = `[${queryVector.join(',')}]`;

  const result = await db.execute(sql`
    SELECT id, level, title, summary, emotional_tone,
           characters_present, objects, parent_id,
           embedding <=> ${vectorLiteral}::vector AS distance
    FROM story_sections
    WHERE project_id = ${projectId}
      AND embedding IS NOT NULL
    ORDER BY distance
    LIMIT ${topK}
  `);

  const rows = result as unknown as StorySectionEmbeddingRow[];
  return rows.map((row) => ({
    id: row.id,
    level: row.level,
    title: row.title,
    summary: row.summary,
    emotionalTone: row.emotional_tone,
    charactersPresent: (row.characters_present ?? []) as string[],
    objects: (row.objects ?? []) as string[],
    parentId: row.parent_id,
    score: 1 - Number(row.distance),
  }));
}
