// Custom retrieval tools for Mastra agents.
// These tools allow the story planner and bible builder agents to retrieve
// knowledge from the RAG index, character bible, and wiki.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Repository } from '@audiocomic/db';
import type { EmbeddingProvider } from '@audiocomic/knowledge';
import { searchKnowledgeBase, searchStorySections } from '@audiocomic/knowledge';
import type { Db } from '@audiocomic/db';
import type { MastraModelConfig } from '@mastra/core/llm';

/** Cosine similarity between two equal-length vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface ToolContext {
  repo: Repository;
  embedder: EmbeddingProvider;
  db: Db;
  projectId: string;
  modelConfig?: MastraModelConfig;
}

/**
 * Create Mastra tools bound to a specific project's knowledge base.
 * Each tool is a closure over the project context.
 */
export function createProjectTools(ctx: ToolContext) {
  // 1. Vector search over chapter transcriptions (RAG)
  const vectorQueryTool = createTool({
    id: 'vector-query',
    description:
      'Search across all chapter transcriptions for relevant context. Use this to find mentions of characters, events, or topics across chapters.',
    inputSchema: z.object({
      query: z.string().describe('The search query — what to look for in the transcriptions'),
      topK: z.number().optional().default(5).describe('Number of results to return'),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          text: z.string(),
          score: z.number(),
          metadata: z.record(z.string(), z.unknown()),
        }),
      ),
    }),
    execute: async ({ query, topK }) => {
      const results = await searchKnowledgeBase(ctx.db, ctx.embedder, ctx.projectId, query, topK ?? 5);
      return { results };
    },
  });

  // 2. Character lookup — retrieves character profile + temporal state
  const characterLookupTool = createTool({
    id: 'character-lookup',
    description:
      'Retrieve a character profile and their state at a specific chapter. Use for consistency — check what a character looks like and their situation.',
    inputSchema: z.object({
      characterName: z.string().describe('The character name or alias to look up'),
      atChapter: z.number().optional().describe('Chapter index to get state at (0-based). If omitted, returns latest state.'),
    }),
    outputSchema: z.object({
      found: z.boolean(),
      character: z
        .object({
          name: z.string(),
          description: z.string(),
          role: z.string(),
          aliases: z.array(z.string()),
        })
        .nullable(),
      state: z
        .object({
          outfit: z.string().nullable(),
          location: z.string().nullable(),
          mood: z.string().nullable(),
          chapterIndex: z.number(),
        })
        .nullable(),
    }),
    execute: async ({ characterName, atChapter }) => {
      const characters = await ctx.repo.characterProfiles.getByProjectId(ctx.projectId);

      // Find by name or alias (case-insensitive)
      const char = characters.find(
        (c) =>
          c.name.toLowerCase() === characterName.toLowerCase() ||
          c.aliases.some((a) => a.toLowerCase() === characterName.toLowerCase()),
      );

      if (!char) return { found: false, character: null, state: null };

      // Get character states if chapter specified
      let state: { outfit: string | null; location: string | null; mood: string | null; chapterIndex: number } | null = null;
      const states = await ctx.repo.characterStates.getByProjectId(ctx.projectId);
      const charStates = states
        .filter((s) => s.characterId === char.id)
        .sort((a, b) => a.chapterIndex - b.chapterIndex);

      if (atChapter !== undefined) {
        const stateAtChapter = charStates.find((s) => s.chapterIndex === atChapter);
        if (stateAtChapter) {
          state = {
            outfit: stateAtChapter.outfit ?? null,
            location: stateAtChapter.location ?? null,
            mood: stateAtChapter.mood ?? null,
            chapterIndex: stateAtChapter.chapterIndex,
          };
        }
      } else if (charStates.length > 0) {
        const latest = charStates[charStates.length - 1]!;
        state = {
          outfit: latest.outfit ?? null,
          location: latest.location ?? null,
          mood: latest.mood ?? null,
          chapterIndex: latest.chapterIndex,
        };
      }

      return {
        found: true,
        character: {
          name: char.name,
          description: char.description,
          role: char.role,
          aliases: char.aliases,
        },
        state,
      };
    },
  });

  // 3. World lookup — retrieves world bible + wiki pages
  const worldLookupTool = createTool({
    id: 'world-lookup',
    description:
      'Retrieve the world setting, rules, art style, and relevant wiki pages. Use to understand the world context for story planning.',
    inputSchema: z.object({
      topic: z.string().optional().describe('Optional topic to filter wiki pages by'),
    }),
    outputSchema: z.object({
      worldBible: z
        .object({
          setting: z.string(),
          genre: z.array(z.string()),
          tone: z.string().nullable(),
          artStyle: z.string().nullable(),
          worldRules: z.array(z.string()),
        })
        .nullable(),
      wikiPages: z.array(
        z.object({
          type: z.string(),
          title: z.string(),
          content: z.string(),
        }),
      ),
    }),
    execute: async ({ topic }) => {
      const bibles = await ctx.repo.worldBibles.getByProjectId(ctx.projectId);
      const worldBible = bibles[0] ?? null;

      const pages = await ctx.repo.knowledgePages.getByProjectId(ctx.projectId);
      const filtered = topic
        ? pages.filter(
            (p) => p.title.toLowerCase().includes(topic.toLowerCase()) || p.content.toLowerCase().includes(topic.toLowerCase()),
          )
        : pages;

      return {
        worldBible: worldBible
          ? {
              setting: worldBible.setting,
              genre: worldBible.genre,
              tone: worldBible.tone ?? null,
              artStyle: worldBible.artStyle ?? null,
              worldRules: worldBible.worldRules,
            }
          : null,
        wikiPages: filtered.map((p) => ({
          type: p.type,
          title: p.title,
          content: p.content,
        })),
      };
    },
  });

  // 4. Character timeline — tracks state changes across chapters
  const timelineTool = createTool({
    id: 'character-timeline',
    description:
      'Get the full timeline of a character state changes across all chapters. Use to track outfit changes, location moves, and relationship evolution.',
    inputSchema: z.object({
      characterName: z.string().describe('The character name to get the timeline for'),
    }),
    outputSchema: z.object({
      timeline: z.array(
        z.object({
          chapterIndex: z.number(),
          outfit: z.string().nullable(),
          location: z.string().nullable(),
          mood: z.string().nullable(),
        }),
      ),
    }),
    execute: async ({ characterName }) => {
      const characters = await ctx.repo.characterProfiles.getByProjectId(ctx.projectId);
      const char = characters.find(
        (c) =>
          c.name.toLowerCase() === characterName.toLowerCase() ||
          c.aliases.some((a) => a.toLowerCase() === characterName.toLowerCase()),
      );

      if (!char) return { timeline: [] };

      const states = await ctx.repo.characterStates.getByProjectId(ctx.projectId);
      const charStates = states
        .filter((s) => s.characterId === char.id)
        .sort((a, b) => a.chapterIndex - b.chapterIndex);

      return {
        timeline: charStates.map((s) => ({
          chapterIndex: s.chapterIndex,
          outfit: s.outfit ?? null,
          location: s.location ?? null,
          mood: s.mood ?? null,
        })),
      };
    },
  });

  // 5. Section query — retrieves structured story sections from previously
  //    planned chapters via embedding similarity. Gives the planner
  //    cross-chapter continuity from the structured plan, not just raw
  //    transcript text.
  const sectionQueryTool = createTool({
    id: 'section-query',
    description:
      'Search previously planned story sections (chapters, scenes, beats) by semantic similarity. Use this to find what happened in earlier chapters — events, character interactions, emotional beats — without re-reading raw transcripts. Returns structured section data with level (chapter/scene/beat), summary, emotional tone, and characters present.',
    inputSchema: z.object({
      query: z.string().describe('What to look for — e.g. "character meets ally", "betrayal scene", "arrival at castle"'),
      topK: z.number().optional().default(5).describe('Number of results to return'),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          id: z.string(),
          level: z.string(),
          title: z.string().nullable(),
          summary: z.string(),
          emotionalTone: z.string().nullable(),
          charactersPresent: z.array(z.string()),
          objects: z.array(z.string()),
          score: z.number(),
        }),
      ),
    }),
    execute: async ({ query, topK }) => {
      const results = await searchStorySections(ctx.db, ctx.embedder, ctx.projectId, query, topK ?? 5);
      return { results };
    },
  });

  // 6. List all characters — gives the planner the full roster so it can
  //    reuse existing character names instead of creating duplicates.
  const listCharactersTool = createTool({
    id: 'list-characters',
    description:
      'List ALL existing characters in the project roster. ALWAYS call this first before generating characters, so you can reuse existing names and avoid duplicates. Returns name, role, aliases, and description for each character.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      characters: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          role: z.string(),
          aliases: z.array(z.string()),
          description: z.string(),
        }),
      ),
    }),
    execute: async () => {
      const characters = await ctx.repo.characterProfiles.getByProjectId(ctx.projectId);
      return {
        characters: characters.map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          aliases: c.aliases,
          description: c.description,
        })),
      };
    },
  });

  // 7. Match character — fuzzy match by name + embedding similarity.
  //    Handles cases like "Carl" vs "Carl the Dungeon Crawler" vs "C. Carlson"
  //    where exact name matching fails. Embeds the query description and
  //    compares against existing character descriptions via cosine similarity.
  const matchCharacterTool = createTool({
    id: 'match-character',
    description:
      'Find the best existing character match for a name + description. Use this when you are unsure if a character already exists — e.g. the name is slightly different or is an alias. Returns the closest match above a similarity threshold, or no match.',
    inputSchema: z.object({
      name: z.string().describe('The character name to match'),
      description: z.string().optional().describe('Physical description of the character — improves matching accuracy'),
    }),
    outputSchema: z.object({
      matched: z.boolean(),
      character: z
        .object({
          id: z.string(),
          name: z.string(),
          role: z.string(),
          aliases: z.array(z.string()),
          description: z.string(),
          similarity: z.number(),
        })
        .nullable(),
    }),
    execute: async ({ name, description }) => {
      const characters = await ctx.repo.characterProfiles.getByProjectId(ctx.projectId);
      if (characters.length === 0) return { matched: false, character: null };

      // Layer 1: exact name/alias match (case-insensitive)
      const target = name.toLowerCase().trim();
      const exact = characters.find(
        (c) =>
          c.name.toLowerCase().trim() === target ||
          c.aliases.some((a) => a.toLowerCase().trim() === target),
      );
      if (exact) {
        return {
          matched: true,
          character: {
            id: exact.id,
            name: exact.name,
            role: exact.role,
            aliases: exact.aliases,
            description: exact.description,
            similarity: 1.0,
          },
        };
      }

      // Layer 2: embedding similarity on descriptions
      const queryText = `${name}. ${description ?? ''}`.trim();
      let queryVec: number[];
      try {
        queryVec = await ctx.embedder.embed(queryText);
      } catch {
        // Embedding failed — fall back to substring matching
        const substring = characters.find(
          (c) =>
            c.name.toLowerCase().includes(target) ||
            target.includes(c.name.toLowerCase()) ||
            c.aliases.some((a) => {
              const na = a.toLowerCase().trim();
              return na.includes(target) || target.includes(na);
            }),
        );
        if (substring) {
          return {
            matched: true,
            character: {
              id: substring.id,
              name: substring.name,
              role: substring.role,
              aliases: substring.aliases,
              description: substring.description,
              similarity: 0.7,
            },
          };
        }
        return { matched: false, character: null };
      }

      // Embed all existing character descriptions and compute cosine similarity
      const charTexts = characters.map((c) => `${c.name}. ${c.description}`);
      let charVecs: number[][];
      try {
        charVecs = await ctx.embedder.embedMany(charTexts);
      } catch {
        return { matched: false, character: null };
      }

      let bestIdx = -1;
      let bestSim = -1;
      for (let i = 0; i < charVecs.length; i++) {
        const sim = cosineSimilarity(queryVec, charVecs[i]!);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
        }
      }

      // Threshold: 0.82 means strong semantic similarity
      if (bestIdx >= 0 && bestSim >= 0.82) {
        const c = characters[bestIdx]!;
        return {
          matched: true,
          character: {
            id: c.id,
            name: c.name,
            role: c.role,
            aliases: c.aliases,
            description: c.description,
            similarity: bestSim,
          },
        };
      }

      return { matched: false, character: null };
    },
  });

  return { vectorQueryTool, characterLookupTool, worldLookupTool, timelineTool, sectionQueryTool, listCharactersTool, matchCharacterTool };
}
