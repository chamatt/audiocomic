// Wiki ingestor interface and lint report types.
//
// The WikiIngestor turns chapter transcription text into structured
// KnowledgePage rows (the "wiki"), checks the resulting wiki for internal
// consistency (lint), and answers simple topic queries without leaving the
// database. The concrete implementation lives in `wiki-ingestor.ts`.

import type { LintReport } from './types';
import type { KnowledgePage } from '@audiocomic/domain';

/**
 * Result of ingesting a single chapter into the wiki.
 */
export interface WikiIngestResult {
  pagesCreated: number;
  pagesUpdated: number;
  contradictions: string[];
}

/**
 * Ingest chapter text into the project's wiki, lint the wiki, and query it.
 *
 * Implementations are expected to be cheap to construct — the factory in
 * `wiki-ingestor.ts` wires a `Repository` and a `StoryPlannerAdapter`.
 */
export interface WikiIngestor {
  /**
   * Extract entities from `chapterText`, upserting them as KnowledgePage rows
   * scoped to `projectId`. Existing pages with the same title are patched
   * with the new content + references; contradictions between the new text
   * and existing pages are collected and returned.
   */
  ingestChapter(
    chapterId: string,
    projectId: string,
    chapterText: string,
    chapterIndex: number,
  ): Promise<WikiIngestResult>;

  /**
   * Lint the project's wiki for internal consistency:
   *   - contradictions (pages with `confidence < 1`)
   *   - orphan pages (no cross-references)
   *   - gaps (character pages missing a physical description)
   */
  lint(projectId: string): Promise<LintReport>;

  /**
   * Simple text-matching query over the project's wiki pages. Returns pages
   * whose title or content contains the `topic` substring (case-insensitive).
   */
  query(projectId: string, topic: string): Promise<KnowledgePage[]>;
}

export type { LintReport };
