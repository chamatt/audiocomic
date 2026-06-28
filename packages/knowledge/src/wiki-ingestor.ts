// Concrete `WikiIngestor` implementation.
//
// `ingestChapter` calls an LLM (OpenRouter, mistral-nemo) to extract entities
// from the chapter text, then upserts each entity as a KnowledgePage. `lint`
// checks the resulting wiki for contradictions, orphans, and gaps. `query` is
// a simple substring match over the project's pages — no embeddings required.
//
// The `StoryPlannerAdapter` is accepted by the factory to satisfy the contract
// and for future use; the current extraction path talks to OpenRouter directly
// via `fetch` so the wiki flow can run without the full planner pipeline.

import { z } from 'zod';

import type { Repository } from '@audiocomic/db';
import type { KnowledgePage } from '@audiocomic/domain';
import { getEnv, uuid } from '@audiocomic/shared';

import type { LintReport, WikiEntity, WikiExtractionResult } from './types';
import type { WikiIngestor, WikiIngestResult } from './wiki';

/**
 * Minimal story-planner contract the wiki ingestor accepts. Mirrors the
 * relevant slice of `@audiocomic/ai`'s `StoryPlannerAdapter` so this package
 * does not need to depend on `@audiocomic/ai` (which would create a cycle via
 * the actors package). The planner is currently unused for extraction — the
 * wiki flow talks to OpenRouter directly — but is retained for the contract.
 */
export interface StoryPlannerAdapter {
  planStory(input: unknown): Promise<unknown>;
}

// ----------------------------------------------------------------------------
// LLM extraction
// ----------------------------------------------------------------------------

/** Default OpenRouter model for the extraction pass. */
const EXTRACTION_MODEL = 'mistralai/mistral-nemo';

/**
 * Zod schema for a single entity returned by the LLM. Mirrors `WikiEntity`
 * minus the `contradictsExisting` flag, which is computed locally.
 */
const ExtractedEntitySchema = z.object({
  type: z.enum(['character', 'location', 'object', 'concept', 'event']),
  name: z.string().min(1),
  description: z.string(),
  content: z.string(),
  references: z
    .array(
      z.object({
        chapterId: z.string().optional(),
        quote: z.string().optional(),
      }),
    )
    .default([]),
});

const ExtractionResponseSchema = z.object({
  entities: z.array(ExtractedEntitySchema),
  relationships: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        type: z.string(),
      }),
    )
    .default([]),
});

/**
 * Call OpenRouter with a structured extraction prompt and parse the JSON
 * response into a `WikiExtractionResult`. Falls back to an empty result on
 * failure so a single bad LLM call does not abort the whole ingest.
 */
async function extractEntities(
  chapterId: string,
  chapterText: string,
): Promise<WikiExtractionResult> {
  const env = getEnv();
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // No key configured — skip extraction rather than throwing. Callers can
    // still ingest embeddings via `ingestChapterTranscription`.
    return { entities: [], relationships: [] };
  }

  const prompt = [
    'Extract characters, locations, objects, and events from this text.',
    'Return as JSON with the shape: { "entities": [{ "type": "character"|"location"|"object"|"concept"|"event", "name": string, "description": string, "content": string, "references": [{ "chapterId"?: string, "quote"?: string }] }], "relationships": [{ "from": string, "to": string, "type": string }] }.',
    `The chapter id is "${chapterId}" — include it in each entity's references.chapterId.`,
    'Only include entities explicitly mentioned in the text. Do not invent details.',
    'Text:',
    chapterText,
  ].join('\n');

  let response: Response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://audiocomic.local',
        'X-Title': 'AudioComic wiki ingestor',
      },
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        messages: [
          { role: 'system', content: 'You are a precise entity extractor. Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
  } catch {
    return { entities: [], relationships: [] };
  }

  if (!response.ok) {
    return { entities: [], relationships: [] };
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) {
    return { entities: [], relationships: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entities: [], relationships: [] };
  }

  const result = ExtractionResponseSchema.safeParse(parsed);
  if (!result.success) {
    return { entities: [], relationships: [] };
  }

  const entities: WikiEntity[] = result.data.entities.map((e) => ({
    type: e.type,
    name: e.name,
    description: e.description,
    content: e.content,
    references: e.references.map((r) => ({
      chapterId: r.chapterId ?? chapterId,
      quote: r.quote,
    })),
  }));

  return { entities, relationships: result.data.relationships };
}

// ----------------------------------------------------------------------------
// Upsert + contradiction detection
// ----------------------------------------------------------------------------

/**
 * Detect a contradiction between an existing page and a new entity for the
 * same title. A contradiction is a material disagreement on the description
 * (different non-empty descriptions that are not substrings of each other).
 */
function detectContradiction(
  existing: KnowledgePage,
  entity: WikiEntity,
): string | null {
  if (!entity.description || !existing.content) return null;
  const a = entity.description.trim().toLowerCase();
  const b = existing.content.trim().toLowerCase();
  if (!a || !b) return null;
  if (a === b || a.includes(b) || b.includes(a)) return null;
  return `"${entity.name}": new description disagrees with existing page content`;
}

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

/**
 * Construct a `WikiIngestor` backed by `repo` for persistence and `planner`
 * for the (future) LLM extraction path. The current extraction uses a direct
 * OpenRouter `fetch` call.
 */
export function makeWikiIngestor(
  repo: Repository,
  _planner: StoryPlannerAdapter,
): WikiIngestor {
  return {
    async ingestChapter(
      chapterId: string,
      projectId: string,
      chapterText: string,
      _chapterIndex: number,
    ): Promise<WikiIngestResult> {
      const extraction = await extractEntities(chapterId, chapterText);

      const existing = await repo.knowledgePages.getByProjectId(projectId);
      const byTitle = new Map<string, KnowledgePage>();
      for (const page of existing) {
        byTitle.set(page.title.toLowerCase(), page);
      }

      let pagesCreated = 0;
      let pagesUpdated = 0;
      const contradictions: string[] = [];

      for (const entity of extraction.entities) {
        const key = entity.name.toLowerCase();
        const prior = byTitle.get(key);

        if (prior) {
          const contradiction = detectContradiction(prior, entity);
          if (contradiction) contradictions.push(contradiction);

          const mergedReferences = [
            ...prior.references,
            ...entity.references,
          ];
          const patch = {
            content: entity.content || prior.content,
            references: mergedReferences,
            confidence: contradiction ? 0.5 : 1,
          };
          await repo.knowledgePages.patch(prior.id, patch);
          pagesUpdated++;
        } else {
          await repo.knowledgePages.create({
            id: uuid(),
            projectId,
            type: entity.type,
            title: entity.name,
            content: entity.content || entity.description,
            references: entity.references,
            crossReferences: [],
            confidence: 1,
            updatedAt: new Date().toISOString(),
          });
          pagesCreated++;
        }
      }

      return { pagesCreated, pagesUpdated, contradictions };
    },

    async lint(projectId: string): Promise<LintReport> {
      const pages = await repo.knowledgePages.getByProjectId(projectId);

      const contradictions: string[] = [];
      const orphanPages: string[] = [];
      const gaps: string[] = [];
      const recommendations: string[] = [];

      for (const page of pages) {
        // Contradictions: confidence < 1 means a conflicting update was merged.
        if (page.confidence < 1) {
          contradictions.push(
            `"${page.title}" has confidence ${page.confidence} — conflicting information detected`,
          );
        }

        // Orphans: no cross-references to other pages.
        if (page.crossReferences.length === 0) {
          orphanPages.push(page.title);
        }

        // Gaps: character pages should carry a physical description. We treat
        // a short or placeholder content as a missing description.
        if (page.type === 'character') {
          const content = page.content.trim();
          if (content.length < 20) {
            gaps.push(`Character "${page.title}" lacks a physical description`);
          }
        }
      }

      if (orphanPages.length > 0) {
        recommendations.push(
          `Link ${orphanPages.length} orphan page(s) to related entries to improve wiki connectivity.`,
        );
      }
      if (gaps.length > 0) {
        recommendations.push(
          `Fill in physical descriptions for ${gaps.length} character page(s).`,
        );
      }
      if (contradictions.length > 0) {
        recommendations.push(
          `Resolve ${contradictions.length} contradiction(s) by re-ingesting the source chapter or manually editing the affected pages.`,
        );
      }

      return { contradictions, orphanPages, gaps, recommendations };
    },

    async query(projectId: string, topic: string): Promise<KnowledgePage[]> {
      const pages = await repo.knowledgePages.getByProjectId(projectId);
      const needle = topic.trim().toLowerCase();
      if (!needle) return pages;
      return pages.filter((page) => {
        const title = page.title.toLowerCase();
        const content = page.content.toLowerCase();
        return title.includes(needle) || content.includes(needle);
      });
    },
  };
}
