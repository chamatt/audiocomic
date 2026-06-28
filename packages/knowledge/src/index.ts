// @audiocomic/knowledge — RAG pipeline for the AudioComic knowledge base.
//
// Embedding providers, transcript chunking, chapter ingestion, and vector
// search over the `knowledge_embeddings` table. The optional @mastra/*
// dependencies are not required for the core flow.

export type {
  EmbeddingProvider,
  Chunk,
  SearchResult,
  LintReport,
  WikiEntity,
  WikiExtractionResult,
} from './types';

export type { WikiIngestor, WikiIngestResult } from './wiki';
export type { StoryPlannerAdapter as WikiStoryPlannerAdapter } from './wiki-ingestor';

export { makeWikiIngestor } from './wiki-ingestor';

export {
  OpenAIEmbeddingProvider,
  GroqEmbeddingProvider,
  createEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
} from './embeddings';

export { chunkTranscription } from './chunking';

export { ingestChapterTranscription } from './ingest';
export type { IngestResult } from './ingest';

export { searchKnowledgeBase } from './rag';
