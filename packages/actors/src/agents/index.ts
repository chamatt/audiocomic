// Mastra agents for story planning and bible building.
// These agents use tool calling to retrieve knowledge from the RAG index
// and character bible, enabling cross-chapter consistency.

import { Agent, tryGenerateWithJsonFallback } from "@mastra/core/agent";
import { z } from "zod";
import { createProjectTools, type ToolContext } from "./tools.ts";
import type { StorySection, CharacterProfile, WorldBible } from "@audiocomic/domain";
import type { ProgressEvent } from "@audiocomic/ai";
import { uuid, nowIso, logger } from "@audiocomic/shared";
import type { Repository } from "@audiocomic/db";

/**
 * Resolve the LLM model from env. Falls back to google/gemini-flash-1.5
 * (cheap, reliable structured output) when not configured.
 */
const LLM_MODEL = process.env.DEFAULT_LLM_MODEL
  ? `openrouter/${process.env.DEFAULT_LLM_MODEL}`
  : "openrouter/mistralai/mistral-nemo";

// ============================================================================
// Structured output schemas — 3-pass decomposition
// ============================================================================

const cameraFramingEnum = z.enum([
  "wide",
  "medium",
  "close-up",
  "extreme-close-up",
  "overhead",
  "low-angle",
  "pov",
  "establishing",
]);

const emotionalToneEnum = z.enum([
  "neutral",
  "tense",
  "joyful",
  "sad",
  "angry",
  "fearful",
  "romantic",
  "mysterious",
  "epic",
  "comedic",
  "melancholic",
  "hopeful",
]);

/** Pass 1: world + characters + chapters/scenes (uses KB tools for context) */
const pass1Schema = z.object({
  setting: z.string().describe("Overall world/setting description"),
  genre: z.array(z.string()).default([]),
  tone: z.string().optional(),
  artStyle: z.string().optional(),
  characters: z
    .array(
      z.object({
        name: z.string(),
        aliases: z.array(z.string()).default([]),
        description: z.string().describe("Physical appearance and personality"),
        role: z.string().describe("protagonist, antagonist, supporting, minor, or narrator"),
      }),
    )
    .default([]),
  chapters: z
    .array(
      z.object({
        title: z.string().optional(),
        summary: z.string().describe("Chapter summary"),
        scenes: z
          .array(
            z.object({
              title: z.string().optional(),
              summary: z.string().describe("Scene summary — a distinct narrative moment"),
              textExcerpt: z.string().optional().describe("Verbatim source text for this scene"),
              emotionalTone: emotionalToneEnum.default("neutral"),
              charactersPresent: z.array(z.string()).default([]),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

/** Pass 2: beats within a single scene */
const pass2Schema = z.object({
  beats: z
    .array(
      z.object({
        summary: z.string().describe("One visual moment — will become 1+ panels"),
        text: z.string().optional().describe("Verbatim source text for this beat"),
        emotionalTone: emotionalToneEnum.default("neutral"),
        cameraHint: cameraFramingEnum.optional(),
        charactersPresent: z.array(z.string()).default([]),
        objects: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

/** Pass 3: panel allocation hints per beat */
const pass3Schema = z.object({
  panels: z
    .array(
      z.object({
        beatIndex: z.number().int().nonnegative(),
        description: z.string().describe("Visual description of the panel"),
        cameraFraming: cameraFramingEnum.optional(),
        characters: z
          .array(
            z.object({
              name: z.string(),
              pose: z.string().optional(),
              expression: z.string().optional(),
              position: z.enum(["left", "center", "right", "background"]).optional(),
            }),
          )
          .default([]),
        dialogueLines: z
          .array(
            z.object({
              speaker: z.string(),
              text: z.string(),
              type: z.enum(["speech", "thought", "narration", "sfx"]).default("speech"),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
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
      type: z.enum(["character", "location", "object", "concept", "event"]),
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
  /** Run the 3-pass story planner with KB tool calls, returning structured plan output. */
  planStory(input: {
    projectId: string;
    text: string;
    emit?: (event: ProgressEvent) => void;
  }): Promise<{
    sections: StorySection[];
    characters: CharacterProfile[];
    worldBible: WorldBible;
    panelHints?: import("@audiocomic/ai").PanelHint[];
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
    name: "Story Planner",
    instructions: `You are a comic story planner. Decompose an audiobook chapter into a structured plan for adaptation into a narrated comic.

STEP 1: Use the available tools to gather cross-chapter context:
- Use vector-query to find relevant events and mentions from other chapters
- Use character-lookup to get each character's current state and appearance
- Use character-timeline to check for outfit/state changes across chapters
- Use world-lookup to get the world setting, rules, and art style

STEP 2: Break the text into chapters and scenes. Each scene is a distinct narrative moment with its own location, time, and emotional tone. Include a short verbatim textExcerpt from the source for each scene so later passes can extract beats.

STEP 3: Identify all characters, their physical appearance, and role. Characters should look and act the same as in previous chapters unless there's a narrative reason for change.

Output: structured JSON with world setting, characters (with descriptions and roles), chapters (each containing scenes with summaries and text excerpts), and character states.`,
    model: LLM_MODEL,
    tools,
  });
}

/**
 * Create a beat decomposer agent for pass 2. No tools needed — just
 * breaks a scene into visual beats. Uses the same model for consistency.
 */
function makeBeatDecomposerAgent(projectId: string): Agent {
  return new Agent({
    id: `beat-decomposer-${projectId}`,
    name: "Beat Decomposer",
    instructions: `You are a comic beat breakdown assistant. Split the given scene into a sequence of narrative beats. Each beat is ONE visual moment that will become one or more comic panels. Aim for 3-8 beats per scene. Preserve the scene's emotional tone unless a beat clearly shifts it. Include a camera hint for each beat.`,
    model: LLM_MODEL,
  });
}

/**
 * Create a panel layout agent for pass 3. No tools needed — just
 * generates panel descriptions and dialogue per beat.
 */
function makePanelLayoutAgent(projectId: string): Agent {
  return new Agent({
    id: `panel-layout-${projectId}`,
    name: "Panel Layout",
    instructions: `You are a comic layout planner. For each beat, propose 1 panel. Describe the visual content, camera framing, which characters appear and their pose/expression, and any dialogue/narration lines. beatIndex must match the supplied beat list order (0-based).`,
    model: LLM_MODEL,
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
    name: "Bible Builder",
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
  beatAgent: Agent,
  panelAgent: Agent,
  projectId: string,
): StoryPlannerAgentHandle {
  return {
    async planStory({ text, emit }) {
      const log = logger.scoped("story-planner");
      const startTime = Date.now();
      log.info("planStory started", { textLength: text.length, projectId });
      emit?.({ type: "progress", label: "Pass 1: Planning story structure" });

      // ── Pass 1: chapters + scenes + world + characters (with KB tools) ──
      log.info("Pass 1: calling agent with KB tools (maxSteps: 15)", { projectId });
      const pass1Response = await tryGenerateWithJsonFallback(
        agent,
        `Decompose this chapter transcript into a comic plan. ` +
          `First use the available tools to look up existing characters, world info, ` +
          `and cross-chapter context via vector search. ` +
          `Then break the text into chapters and scenes with verbatim excerpts.\n\nTranscript:\n${text}`,
        {
          maxSteps: 15,
          structuredOutput: { schema: pass1Schema },
          prepareStep: async ({ stepNumber, messages }) => {
            // Log tool calls and results from the most recent message
            if (messages && messages.length > 0) {
              const lastMsg = messages[messages.length - 1] as {
                toolCalls?: { toolName: string; args?: unknown }[];
                toolResults?: { toolName: string; result?: unknown; isError?: boolean }[];
              };
              if (lastMsg.toolCalls?.length) {
                log.info(
                  `Pass 1: step ${stepNumber} — tool calls: ${lastMsg.toolCalls.map((t) => `${t.toolName}(${JSON.stringify(t.args ?? {}).slice(0, 100)})`).join(", ")}`,
                );
              }
              if (lastMsg.toolResults?.length) {
                for (const tr of lastMsg.toolResults) {
                  const resultStr =
                    typeof tr.result === "string"
                      ? tr.result.slice(0, 200)
                      : JSON.stringify(tr.result ?? "").slice(0, 200);
                  log.info(
                    `Pass 1: step ${stepNumber} — tool result: ${tr.toolName} → ${tr.isError ? "ERROR: " : ""}${resultStr}`,
                  );
                }
              }
              if (!lastMsg.toolCalls?.length && stepNumber > 1) {
                log.info(`Pass 1: step ${stepNumber} — generating structured output`);
              }
            }
            // Step 1: force tool usage. Steps 2-3: allow tools. Step 4+: force structured output.
            if (stepNumber < 2) return { toolChoice: "required" };
            if (stepNumber < 4) return { toolChoice: "auto" };
            return {
              tools: undefined,
              toolChoice: "none",
              structuredOutput: { schema: pass1Schema },
            };
          },
        },
      );
      log.info("Pass 1: agent response received", {
        elapsed: `${Date.now() - startTime}ms`,
        hasObject: !!pass1Response.object,
      });

      const pass1 = pass1Response.object;
      if (!pass1) throw new Error("Pass 1: no structured output");
      // Normalize — Zod .default([]) produces T | undefined in Mastra output
      const pass1Chars = pass1.characters ?? [];
      const pass1Chapters = pass1.chapters ?? [];
      const pass1Genre = pass1.genre ?? [];

      emit?.({
        type: "progress",
        label: `Pass 1 done: ${pass1Chapters.length} chapters, ${pass1Chars.length} characters`,
      });

      // ── Build characters + world bible ──
      const nameToId = new Map<string, string>();

      const characters: CharacterProfile[] = pass1Chars.map((c) => {
        const id = uuid();
        nameToId.set(c.name.toLowerCase(), id);
        for (const alias of c.aliases ?? []) nameToId.set(alias.toLowerCase(), id);
        return {
          id,
          projectId,
          name: c.name,
          aliases: c.aliases ?? [],
          description: c.description,
          role: (
            ["protagonist", "antagonist", "supporting", "minor", "narrator"] as const
          ).includes(
            c.role?.toLowerCase() as
              | "protagonist"
              | "antagonist"
              | "supporting"
              | "minor"
              | "narrator",
          )
            ? (c.role.toLowerCase() as
                | "protagonist"
                | "antagonist"
                | "supporting"
                | "minor"
                | "narrator")
            : "supporting",
          outfitRefs: [],
          paletteNotes: [],
          negativeConstraints: [],
          locked: false,
        };
      });

      const worldBible: WorldBible = {
        id: uuid(),
        projectId,
        setting: pass1.setting,
        genre: pass1Genre,
        tone: pass1.tone,
        artStyle: pass1.artStyle,
        artStyleNegative: [],
        colorPalette: [],
        worldRules: [],
      };

      // ── Build chapter + scene sections ──
      const sections: StorySection[] = [];
      const sceneSections: { section: StorySection; excerpt: string }[] = [];

      let chapterIndex = 0;
      for (const chapter of pass1Chapters) {
        const chapterId = uuid();
        sections.push({
          id: chapterId,
          projectId,
          level: "chapter",
          index: chapterIndex,
          title: chapter.title,
          summary: chapter.summary,
          charactersPresent: [],
          emotionalTone: "neutral",
          objects: [],
        });

        let sceneIndex = 0;
        for (const scene of chapter.scenes ?? []) {
          const sceneId = uuid();
          const sceneSection: StorySection = {
            id: sceneId,
            projectId,
            parentId: chapterId,
            level: "scene",
            index: sceneIndex,
            title: scene.title,
            summary: scene.summary,
            text: scene.textExcerpt,
            emotionalTone: scene.emotionalTone as StorySection["emotionalTone"],
            charactersPresent: (scene.charactersPresent ?? [])
              .map((name) => nameToId.get(name.toLowerCase()))
              .filter((id): id is string => id !== undefined),
            objects: [],
          };
          sections.push(sceneSection);
          sceneSections.push({
            section: sceneSection,
            excerpt: scene.textExcerpt ?? scene.summary,
          });
          sceneIndex++;
        }
        chapterIndex++;
      }

      log.info(
        `Pass 1 complete: ${pass1Chapters.length} chapters, ${sceneSections.length} scenes, ${characters.length} characters`,
        { elapsed: `${Date.now() - startTime}ms` },
      );
      log.info(`Pass 2: decomposing ${sceneSections.length} scenes into beats (parallel)`, {
        projectId,
      });
      emit?.({
        type: "progress",
        label: `Pass 2: Decomposing ${sceneSections.length} scenes into beats`,
      });

      // ── Pass 2: beats per scene (parallel, no tools needed) ──
      let pass2Done = 0;
      const beatResults = await Promise.all(
        sceneSections.map(async ({ section, excerpt }) => {
          log.info(
            `Pass 2: scene "${section.title ?? section.summary.slice(0, 40)}" — requesting beats`,
          );
          const pass2Response = await tryGenerateWithJsonFallback(
            beatAgent,
            `Scene summary: ${section.summary}\n\nSource excerpt:\n${excerpt}`,
            { maxSteps: 3, structuredOutput: { schema: pass2Schema } },
          );
          const beats = pass2Response.object?.beats ?? [];
          pass2Done++;
          log.info(
            `Pass 2: scene ${pass2Done}/${sceneSections.length} done — ${beats.length} beats`,
          );
          return { section, beats };
        }),
      );

      // ── Build beat sections ──
      const beatSectionLookup: { beatIndex: number; section: StorySection }[] = [];
      for (const { section, beats } of beatResults) {
        beats.forEach((beat, beatIndex) => {
          const beatId = uuid();
          const beatSection: StorySection = {
            id: beatId,
            projectId,
            parentId: section.id,
            level: "beat",
            index: beatIndex,
            summary: beat.summary,
            text: beat.text,
            emotionalTone: beat.emotionalTone as StorySection["emotionalTone"],
            cameraHint: beat.cameraHint as StorySection["cameraHint"],
            charactersPresent: (beat.charactersPresent ?? [])
              .map((name) => nameToId.get(name.toLowerCase()))
              .filter((id): id is string => id !== undefined),
            objects: beat.objects ?? [],
          };
          sections.push(beatSection);
          beatSectionLookup.push({ beatIndex, section: beatSection });
        });
      }

      log.info(
        `Pass 2 complete: ${beatSectionLookup.length} beats from ${sceneSections.length} scenes`,
        { elapsed: `${Date.now() - startTime}ms` },
      );
      emit?.({ type: "progress", label: `Pass 2 done: ${beatSectionLookup.length} beats` });

      // ── Pass 3: panel hints per beat group (parallel, no tools needed) ──
      log.info(`Pass 3: generating panel hints for ${beatResults.length} beat groups (parallel)`, {
        projectId,
      });
      let pass3Done = 0;
      const panelHintResults = await Promise.all(
        beatResults.map(async ({ beats }) => {
          if (beats.length === 0) return [];
          const pass3Response = await tryGenerateWithJsonFallback(
            panelAgent,
            beats
              .map(
                (b, i) =>
                  `Beat ${i}: ${b.summary}` +
                  (b.cameraHint ? ` [camera: ${b.cameraHint}]` : "") +
                  (b.charactersPresent?.length
                    ? ` (characters: ${(b.charactersPresent ?? []).join(", ")})`
                    : ""),
              )
              .join("\n"),
            { maxSteps: 3, structuredOutput: { schema: pass3Schema } },
          );
          const panels = pass3Response.object?.panels ?? [];
          pass3Done++;
          log.info(
            `Pass 3: group ${pass3Done}/${beatResults.length} done — ${panels.length} panels`,
          );
          return panels;
        }),
      );

      // ── Map pass 3 panels to PanelHints ──
      const panelHints: import("@audiocomic/ai").PanelHint[] = [];
      for (const panels of panelHintResults) {
        for (const panel of panels) {
          const beat = beatSectionLookup.find((b) => b.beatIndex === panel.beatIndex);
          if (!beat) continue;
          panelHints.push({
            beatSectionId: beat.section.id,
            beatIndex: panel.beatIndex,
            description: panel.description,
            cameraFraming: panel.cameraFraming as
              | import("@audiocomic/domain").CameraFraming
              | undefined,
            characters: panel.characters ?? [],
            dialogueLines: (panel.dialogueLines ?? []).map((d) => ({
              ...d,
              type: d.type ?? "speech",
            })),
          });
        }
      }

      log.info(
        `planStory complete: ${sections.length} sections, ${panelHints.length} panel hints, ${characters.length} characters`,
        { totalElapsed: `${Date.now() - startTime}ms` },
      );
      emit?.({
        type: "llm_done",
        label: "Story planner completed",
        detail: `${sections.length} sections, ${panelHints.length} panel hints`,
      });

      return { sections, characters, worldBible, panelHints };
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
              return { toolChoice: "auto" };
            }
            return {
              tools: undefined,
              toolChoice: "none",
              structuredOutput: { schema: bibleBuildSchema },
            };
          },
        },
      );

      const result = response.object;
      if (!result) throw new Error("Bible builder agent returned no structured output");

      const now = nowIso();
      let newCharacters = 0;
      let newStates = 0;
      let newWikiPages = 0;

      // Persist new characters
      const existingChars = await repo.characterProfiles.getByProjectId(projectId);
      for (const c of result.characters) {
        if (c.isNew) {
          const exists = existingChars.some((e) => e.name.toLowerCase() === c.name.toLowerCase());
          if (!exists) {
            await repo.characterProfiles.create({
              id: uuid(),
              projectId,
              name: c.name,
              description: c.description,
              role: (
                ["protagonist", "antagonist", "supporting", "minor", "narrator"] as const
              ).includes(
                c.role?.toLowerCase() as
                  | "protagonist"
                  | "antagonist"
                  | "supporting"
                  | "minor"
                  | "narrator",
              )
                ? (c.role.toLowerCase() as
                    | "protagonist"
                    | "antagonist"
                    | "supporting"
                    | "minor"
                    | "narrator")
                : "supporting",
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
  const beatAgent = makeBeatDecomposerAgent(ctx.projectId);
  const panelAgent = makePanelLayoutAgent(ctx.projectId);
  const bibleAgent = makeBibleBuilderAgent(ctx);

  return {
    storyPlanner: makeStoryPlannerHandle(storyAgent, beatAgent, panelAgent, ctx.projectId),
    bibleBuilder: makeBibleBuilderHandle(bibleAgent, ctx.repo, ctx.projectId),
  };
}
