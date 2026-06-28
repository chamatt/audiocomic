-- 0001_chapters_and_knowledge.sql
-- Adds chapter entity, temporal character states, knowledge pages, and knowledge embeddings.
-- Also adds chapter_id to source_assets and transcript_chunks, and embedding column to transcript_chunks.

-- Chapters — first-class chapter entity per project
CREATE TABLE IF NOT EXISTS chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  index INTEGER NOT NULL,
  title VARCHAR(512) NOT NULL,
  description TEXT,
  source_asset_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  duration_sec REAL,
  transcription_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chapters_project_id_idx ON chapters (project_id);
CREATE INDEX IF NOT EXISTS chapters_project_order_idx ON chapters (project_id, index);

-- Add chapter_id to source_assets
ALTER TABLE source_assets ADD COLUMN IF NOT EXISTS chapter_id UUID;

-- Add chapter_id and embedding to transcript_chunks
ALTER TABLE transcript_chunks ADD COLUMN IF NOT EXISTS chapter_id UUID;
ALTER TABLE transcript_chunks ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS transcript_chunks_chapter_id_idx ON transcript_chunks (chapter_id);
CREATE INDEX IF NOT EXISTS transcript_chunks_embedding_idx ON transcript_chunks USING hnsw (embedding vector_cosine_ops);

-- Character states — temporal character state per chapter
CREATE TABLE IF NOT EXISTS character_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  character_id UUID NOT NULL,
  chapter_id UUID NOT NULL,
  chapter_index INTEGER NOT NULL,
  outfit TEXT,
  location TEXT,
  mood TEXT,
  relationships JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  provenance TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS character_states_project_char_idx ON character_states (project_id, character_id);
CREATE INDEX IF NOT EXISTS character_states_char_chapter_idx ON character_states (character_id, chapter_id);

-- Knowledge pages — LLM-wiki structured knowledge entries
CREATE TABLE IF NOT EXISTS knowledge_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  type TEXT NOT NULL,
  title VARCHAR(512) NOT NULL,
  content TEXT NOT NULL,
  "references" JSONB NOT NULL DEFAULT '[]',
  cross_references JSONB NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_pages_project_id_idx ON knowledge_pages (project_id);
CREATE INDEX IF NOT EXISTS knowledge_pages_project_type_idx ON knowledge_pages (project_id, type);

-- Knowledge embeddings — vector embeddings for RAG over chapter transcriptions
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  chapter_id UUID,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_embeddings_project_id_idx ON knowledge_embeddings (project_id);
CREATE INDEX IF NOT EXISTS knowledge_embeddings_embedding_idx ON knowledge_embeddings USING hnsw (embedding vector_cosine_ops);
