// Public types for the @audiocomic/knowledge package.
//
// These describe the contracts shared by embedding providers, the chunking
// pipeline, vector search, and the (future) wiki/lint tooling. They are
// deliberately framework-agnostic so the core flow can run without the
// optional @mastra/* dependencies.

/**
 * Pluggable embedding provider. Implementations are expected to be cheap to
 * construct — the factory in `embeddings.ts` selects one from env.
 */
export interface EmbeddingProvider {
  /** Embed a single text into a fixed-dimension vector. */
  embed(text: string): Promise<number[]>;
  /** Embed many texts, returning one vector per input, in order. */
  embedMany(texts: string[]): Promise<number[][]>;
}

/**
 * A chunk of transcript text ready for embedding. Metadata preserves the
 * provenance needed to cite results back to a chapter and time range.
 */
export interface Chunk {
  text: string;
  metadata: {
    chapterId?: string;
    chunkIndex: number;
    startSec?: number;
    endSec?: number;
    speaker?: string;
  };
}

/**
 * A single vector-search hit. `score` is a similarity score — higher is more
 * relevant (callers convert distance → similarity as needed).
 */
export interface SearchResult {
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * Report from a knowledge-base linter that checks the wiki for internal
 * consistency against the source transcription.
 */
export interface LintReport {
  contradictions: string[];
  orphanPages: string[];
  gaps: string[];
  recommendations: string[];
}

/**
 * An entity extracted from the transcription that should become (or update) a
 * KnowledgePage. `type` mirrors the domain `KnowledgePageType` minus the
 * `timeline` variant (timeline entries are produced by a dedicated pass).
 */
export interface WikiEntity {
  type: 'character' | 'location' | 'object' | 'concept' | 'event';
  name: string;
  description: string;
  content: string;
  references: {
    chapterId?: string;
    quote?: string;
  }[];
  contradictsExisting?: boolean;
}

/**
 * Result of an LLM extraction pass over chapter transcription: the entities
 * to upsert and the relationships between them.
 */
export interface WikiExtractionResult {
  entities: WikiEntity[];
  relationships: {
    from: string;
    to: string;
    type: string;
  }[];
}
