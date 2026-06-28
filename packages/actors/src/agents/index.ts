// Mastra agents for story planning and bible building.
// These agents use tool calling to retrieve knowledge from the RAG index
// and character bible, enabling cross-chapter consistency.

import { Agent, tryGenerateWithJsonFallback } from '@mastra/core/agent';
import { z } from 'zod';
import { createProjectTools, type ToolContext } from './tools.ts';
import type { StorySection, CharacterProfile, WorldBible } from '@audiocomic/domain';
import type { ProgressEvent } from '@audiocomic/ai';
import { uuid, nowIso } from '@audiocomic/shared';
import type { Repository } from '@audiocomic/db';

/**
 * Resolve the LLM model from env. Falls back to google/gemini-flash-1.5
 * (cheap, reliable structured output) when not configured.
 */
const LLM_MODEL = process.env.DEFAULT_LLM_MODEL
  ? `openrouter/${process.env.DEFAULT_LLM_MODEL}`
  : 'openrouter/mistralai/mistral-nemo';


// ============================================================================
// Structured output schemas for agent.generate()
// ============================================================================

const storyPlanSchema = z.object({
  world: z.object({
    setting: z.string(),
    genre: z.array(z.string()),
    tone: z.string(),
    artStyle: z.string(),
  }),
  characters: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      role: z.string(),
      aliases: z.array(z.string()),
    }),
  ),
  sections: z.array(
    z.object({
      level: z.enum(['chapter', 'scene', 'beat']),
      title: z.string(),
      summary: z.string(),
      charactersPresent: z.array(z.string()),
      emotionalTone: z.string(),
    }),
  ),
  characterStates: z.array(
    z.object({
      characterName: z.string(),
      outfit: z.string(),
      location: z.string(),
      mood: z.string(),
    }),
  ),
});

const bibleBuildSchema = z.object({
  characters: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      role: z.string(),
      isNew: z.boolean(),
    }),
  ),
  characterStates: z.array(
    z.object({
      characterName: z.string(),
      outfit: z.string(),
      location: z.string(),
      mood: z.string(),
      notes: z.string(),
    }),
  ),
  worldUpdates: z.object({
    setting: z.string().optional(),
    newRules: z.array(z.string()),
  }),
  wikiPages: z.array(
    z.object({
      type: z.enum(['character', 'location', 'object', 'concept', 'event']),
      title: z.string(),
      content: z.string(),
    }),
  ),
  contradictions: z.array(
    z.object({
      description: z.string(),
      existingInfo: z.string(),
      newInfo: z.string(),
    }),
  ),
});

// ============================================================================
// Agent handle types — what the bridge exposes to step executors
// ============================================================================

export interface StoryPlannerAgentHandle {
  /** Run the story planner agent with tool calls, returning structured plan output. */
  planStory(input: {
    projectId: string;
    text: string;
    emit?: (event: ProgressEvent) => void;
  }): Promise<{
    sections: StorySection[];
    characters: CharacterProfile[];
    worldBible: WorldBible;
  }>;
}

export interface BibleBuilderAgentHandle {
  /** Run the bible builder agent over a chapter transcription, persisting results. */
  buildBible(input: {
    projectId: string;
    chapterId: string;
    chapterIndex: number;
    text: string;
  }): Promise<{
    newCharacters: number;
    newStates: number;
    newWikiPages: number;
    contradictions: number;
  }>;
}

// ============================================================================
// Agent factory
// ============================================================================

/**
 * Create a story planner agent for a specific project.
 * The agent uses tool calls to retrieve character states, world context,
 * and cross-chapter information before planning the comic adaptation.
 */
function makeStoryPlannerAgent(ctx: ToolContext): Agent {
  const tools = createProjectTools(ctx);

  return new Agent({
    id: `story-planner-${ctx.projectId}`,
    name: 'Story Planner',
    instructions: `You are a story planner for an audiobook-to-comic system.

When planning a chapter:
1. Use character-lookup to get each character's current state and appearance
2. Use character-timeline to check for outfit/state changes across chapters
3. Use world-lookup to get the world setting, rules, and art style
4. Use vector-query to find relevant events from other chapters
5. Plan the story with consistency: characters should look and act the same
   as in previous chapters unless there's a narrative reason for change

Output: structured JSON with world, characters, sections, and character states.`,
    model: LLM_MODEL,
    tools,
  });
}

/**
 * Create a bible builder agent for a specific project.
 * The agent extracts characters, locations, and events from chapter
 * transcriptions and maintains the story bible with temporal tracking.
 */
function makeBibleBuilderAgent(ctx: ToolContext): Agent {
  const tools = createProjectTools(ctx);

  return new Agent({
    id: `bible-builder-${ctx.projectId}`,
    name: 'Bible Builder',
    instructions: `You build and maintain the story bible from chapter transcriptions.

When processing a new chapter:
1. Extract characters, locations, objects, events from the text
2. Use character-lookup to check if characters already exist in the bible
3. Use character-timeline to track state changes (outfit, location, mood)
4. Use world-lookup to check existing world information
5. Use vector-query to find related context from other chapters
6. Flag contradictions with previous chapters

Output: structured JSON with knowledge updates.`,
    model: LLM_MODEL,
    tools,
  });
}

// ============================================================================
// Handle implementations — wrap Mastra Agent + persist results to DB
// ============================================================================

function makeStoryPlannerHandle(
  agent: Agent,
  projectId: string,
): StoryPlannerAgentHandle {
  return {
    async planStory({ text, emit }) {
      emit?.({ type: 'progress', label: 'Story planner agent started' });

      const response = await tryGenerateWithJsonFallback(
        agent,
        `Plan the comic adaptation for the following transcription. ` +
          `Use the available tools to look up existing characters, world info, ` +
          `and cross-chapter context before planning. ` +
          `After using tools, produce the structured JSON output.\n\nTranscription:\n${text}`,
        {
          maxSteps: 15,
          structuredOutput: { schema: storyPlanSchema },
          prepareStep: async ({ stepNumber }) => {
            // Steps 0-2: allow tool calls. Step 3+: force structured output without tools.
            if (stepNumber < 3) {
              return { toolChoice: 'auto' };
            }
            return {
              tools: undefined,
              toolChoice: 'none',
              structuredOutput: { schema: storyPlanSchema },
            };
          },
        },
      );

      const plan = response.object;
      if (!plan) throw new Error('Story planner agent returned no structured output');

      emit?.({ type: 'llm_done', label: 'Story planner agent completed', detail: `${plan.sections.length} sections planned` });

      // Map agent output to domain types
      const characters: CharacterProfile[] = plan.characters.map((c) => ({
        id: uuid(),
        projectId,
        name: c.name,
        description: c.description,
        role: (['protagonist', 'antagonist', 'supporting', 'minor', 'narrator'] as const).includes(
          c.role?.toLowerCase() as 'protagonist' | 'antagonist' | 'supporting' | 'minor' | 'narrator',
        )
          ? (c.role.toLowerCase() as 'protagonist' | 'antagonist' | 'supporting' | 'minor' | 'narrator')
          : 'supporting',
        aliases: c.aliases,
        outfitRefs: [],
        paletteNotes: [],
        negativeConstraints: [],
        locked: false,
      }));

      const worldBible: WorldBible = {
        id: uuid(),
        projectId,
        setting: plan.world.setting,
        genre: plan.world.genre,
        tone: plan.world.tone,
        artStyle: plan.world.artStyle,
        artStyleNegative: [],
        colorPalette: [],
        worldRules: [],
      };

      // Build hierarchical sections from the flat list
      const sections: StorySection[] = [];
      let chapterId: string | undefined;
      let sceneId: string | undefined;

      for (const s of plan.sections) {
        const id = uuid();
        if (s.level === 'chapter') {
          chapterId = id;
          sceneId = undefined;
        } else if (s.level === 'scene') {
          sceneId = id;
        }
        const parentId = s.level === 'chapter' ? undefined : s.level === 'scene' ? chapterId : sceneId;
        const tone = ([
          'neutral', 'tense', 'joyful', 'sad', 'angry', 'fearful',
          'romantic', 'mysterious', 'epic', 'comedic', 'melancholic', 'hopeful',
        ] as const).includes(s.emotionalTone as never)
          ? (s.emotionalTone as never)
          : 'neutral' as const;
        sections.push({
          id,
          projectId,
          parentId,
          level: s.level,
          index: sections.length,
          title: s.title,
          summary: s.summary,
          charactersPresent: s.charactersPresent,
          emotionalTone: tone,
          objects: [],
        });
      }

      return { sections, characters, worldBible };
    },
  };
}

function makeBibleBuilderHandle(
  agent: Agent,
  repo: Repository,
  projectId: string,
): BibleBuilderAgentHandle {
  return {
    async buildBible({ chapterId, chapterIndex, text }) {
      const response = await tryGenerateWithJsonFallback(
        agent,
        `Process this chapter transcription and extract knowledge updates. ` +
          `Use the available tools to check existing characters and world info ` +
          `before extracting. ` +
          `After using tools, produce the structured JSON output.\n\nChapter ${chapterIndex} transcription:\n${text}`,
        {
          maxSteps: 10,
          structuredOutput: { schema: bibleBuildSchema },
          prepareStep: async ({ stepNumber }) => {
            if (stepNumber < 3) {
              return { toolChoice: 'auto' };
            }
            return {
              tools: undefined,
              toolChoice: 'none',
              structuredOutput: { schema: bibleBuildSchema },
            };
          },
        },
      );

      const result = response.object;
      if (!result) throw new Error('Bible builder agent returned no structured output');

      const now = nowIso();
      let newCharacters = 0;
      let newStates = 0;
      let newWikiPages = 0;

      // Persist new characters
      const existingChars = await repo.characterProfiles.getByProjectId(projectId);
      for (const c of result.characters) {
        if (c.isNew) {
          const exists = existingChars.some(
            (e) => e.name.toLowerCase() === c.name.toLowerCase(),
          );
          if (!exists) {
            await repo.characterProfiles.create({
              id: uuid(),
              projectId,
              name: c.name,
              description: c.description,
              role: (['protagonist', 'antagonist', 'supporting', 'minor', 'narrator'] as const).includes(
                c.role?.toLowerCase() as 'protagonist' | 'antagonist' | 'supporting' | 'minor' | 'narrator',
              )
                ? (c.role.toLowerCase() as 'protagonist' | 'antagonist' | 'supporting' | 'minor' | 'narrator')
                : 'supporting',
              aliases: [],
              createdAt: now,
            });
            newCharacters++;
          }
        }
      }

      // Persist character states
      const allChars = await repo.characterProfiles.getByProjectId(projectId);
      for (const cs of result.characterStates) {
        const char = allChars.find(
          (c) =>
            c.name.toLowerCase() === cs.characterName.toLowerCase() ||
            c.aliases.some((a) => a.toLowerCase() === cs.characterName.toLowerCase()),
        );
        if (char) {
          await repo.characterStates.create({
            id: uuid(),
            projectId,
            characterId: char.id,
            chapterId,
            chapterIndex,
            outfit: cs.outfit || undefined,
            location: cs.location || undefined,
            mood: cs.mood || undefined,
            relationships: [],
            notes: cs.notes || undefined,
            provenance: `Extracted by bible builder agent from chapter ${chapterIndex}`,
            createdAt: now,
          });
          newStates++;
        }
      }

      // Persist wiki pages
      for (const wp of result.wikiPages) {
        await repo.knowledgePages.create({
          id: uuid(),
          projectId,
          type: wp.type,
          title: wp.title,
          content: wp.content,
          references: [],
          crossReferences: [],
          confidence: 1,
          updatedAt: now,
        });
        newWikiPages++;
      }

      return {
        newCharacters,
        newStates,
        newWikiPages,
        contradictions: result.contradictions.length,
      };
    },
  };
}

// ============================================================================
// Factory — creates agent handles bound to a project's knowledge base
// ============================================================================

/**
 * Create story planner and bible builder agent handles for a project.
 * Agents are cached per-project after first creation.
 */
export function createAgentHandles(ctx: ToolContext): {
  storyPlanner: StoryPlannerAgentHandle;
  bibleBuilder: BibleBuilderAgentHandle;
} {
  const storyAgent = makeStoryPlannerAgent(ctx);
  const bibleAgent = makeBibleBuilderAgent(ctx);

  return {
    storyPlanner: makeStoryPlannerHandle(storyAgent, ctx.projectId),
    bibleBuilder: makeBibleBuilderHandle(bibleAgent, ctx.repo, ctx.projectId),
  };
}
