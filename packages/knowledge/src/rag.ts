// Vector search over the knowledge base.
//
// Embeds the query with the supplied provider and runs a pgvector cosine
// distance query against `knowledge_embeddings` via Drizzle's `db.execute`.
// The Repository does not expose raw SQL for this table, so callers pass the
// `Db` instance from `createDb()` directly.

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
