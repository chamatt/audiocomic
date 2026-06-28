import { z } from 'zod';
import {
  generateObject,
  streamObject,
  type LanguageModelV1,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type {
  StorySection,
  CharacterProfile,
  WorldBible,
  CameraFraming,
  EmotionalTone,
} from '@audiocomic/domain';
import type { Env } from '@audiocomic/shared';
import { uuid } from '@audiocomic/shared';
import type {
  StoryPlanInput,
  StoryPlanOutput,
  StoryPlannerAdapter,
  PanelHint,
  LLMProvider,
  ProgressEvent,
} from './types';

// ============================================================================
// Language model resolution
// ============================================================================

function resolveLanguageModel(
  provider: LLMProvider,
  model: string,
  env: Env,
): LanguageModelV1 {
  switch (provider) {
    case 'openai': {
      if (!env.OPENAI_API_KEY) throw new Error('OpenAI LLM requires OPENAI_API_KEY');
      return createOpenAI({ apiKey: env.OPENAI_API_KEY, compatibility: 'compatible' }).chat(model, { structuredOutputs: false });
    }
    case 'anthropic': {
      if (!env.ANTHROPIC_API_KEY) throw new Error('Anthropic LLM requires ANTHROPIC_API_KEY');
      return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(model);
    }
    case 'google': {
      if (!env.GOOGLE_GENERATIVE_AI_API_KEY)
        throw new Error('Google LLM requires GOOGLE_GENERATIVE_AI_API_KEY');
      return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(model);
    }
    case 'groq': {
      // Groq is OpenAI-compatible; reuse the OpenAI provider against Groq's base URL.
      if (!env.GROQ_API_KEY) throw new Error('Groq LLM requires GROQ_API_KEY');
      return createOpenAI({
        apiKey: env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
        compatibility: 'compatible',
      }).chat(model);
    }
    case 'openrouter': {
      // OpenRouter is OpenAI-compatible; reuse the OpenAI provider against OpenRouter's base URL.
      if (!env.OPENROUTER_API_KEY) throw new Error('OpenRouter LLM requires OPENROUTER_API_KEY');
      return createOpenAI({
        apiKey: env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        compatibility: 'compatible',
      }).chat(model);
    }
    default:
      throw new Error(`Unsupported LLM provider: ${provider satisfies never}`);
  }
}

// ============================================================================
// Zod schemas for the three planner passes
// ============================================================================

const emotionalToneEnum = z.enum([
  'neutral', 'tense', 'joyful', 'sad', 'angry', 'fearful',
  'romantic', 'mysterious', 'epic', 'comedic', 'melancholic', 'hopeful',
]);

const cameraFramingEnum = z.enum([
  'wide', 'medium', 'close-up', 'extreme-close-up', 'overhead', 'low-angle', 'pov', 'establishing',
]);

const characterRoleEnum = z.enum([
  'protagonist', 'antagonist', 'supporting', 'minor', 'narrator',
]);

/** Pass 1: world + characters + chapters/scenes */
const Pass1Schema = z.object({
  setting: z.string().describe('Overall world/setting description'),
  genre: z.array(z.string()),
  tone: z.string(),
  artStyle: z.string(),
  artStyleNegative: z.array(z.string()),
  colorPalette: z.array(z.string()),
  worldRules: z.array(z.string()),
  characters: z
    .array(
      z.object({
        name: z.string(),
        aliases: z.array(z.string()),
        description: z.string(),
        role: characterRoleEnum,
        paletteNotes: z.array(z.string()),
        negativeConstraints: z.array(z.string()),
      }),
    ),
  chapters: z
    .array(
      z.object({
        title: z.string(),
        summary: z.string(),
        scenes: z
          .array(
            z.object({
              title: z.string(),
              summary: z.string(),
              textExcerpt: z.string().describe('Verbatim source text for this scene'),
              emotionalTone: emotionalToneEnum,
              charactersPresent: z.array(z.string()),
            }),
          ),
      }),
    ),
});

type Pass1Result = z.infer<typeof Pass1Schema>;

/** Pass 2: beats within a single scene */
const Pass2Schema = z.object({
  beats: z
    .array(
      z.object({
        summary: z.string(),
        text: z.string(),
        emotionalTone: emotionalToneEnum,
        cameraHint: cameraFramingEnum,
        charactersPresent: z.array(z.string()),
        objects: z.array(z.string()),
      }),
    ),
});

type Pass2Result = z.infer<typeof Pass2Schema>;

/** Pass 3: page/panel allocation hints per beat */
const Pass3Schema = z.object({
  panels: z
    .array(
      z.object({
        beatIndex: z.number().int().nonnegative(),
        description: z.string(),
        cameraFraming: cameraFramingEnum,
        characters: z
          .array(
            z.object({
              name: z.string(),
              pose: z.string(),
              expression: z.string(),
              position: z.enum(['left', 'center', 'right', 'background']),
            }),
          ),
        dialogueLines: z
          .array(
            z.object({
              speaker: z.string(),
              text: z.string(),
              type: z.enum(['speech', 'thought', 'narration', 'sfx']),
            }),
          ),
      }),
    ),
});

type Pass3Result = z.infer<typeof Pass3Schema>;

// ============================================================================
// Helpers
// ============================================================================

/** Cap source text fed to pass 1 to keep within typical context windows. */
const MAX_PASS1_CHARS = 24_000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[...truncated for planning...]`;
}

function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

/** Resolve a list of character names to their profile ids via name/alias map. */
function resolveCharacterIds(
  names: string[],
  nameToId: Map<string, string>,
): string[] {
  const ids = new Set<string>();
  for (const name of names) {
    const id = nameToId.get(normaliseName(name));
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Options for schema-based object generation/streaming.
 *
 * Mirrors the `schema` overload (the `output: 'object'` variant) of the AI
 * SDK's `generateObject`/`streamObject`. `Parameters<typeof generateObject>[0]`
 * resolves to the *last* (no-schema) overload, which rejects `schema`, so the
 * shape we actually use is described here instead.
 */
type StreamObjectOptions<T> = {
  model: LanguageModelV1;
  schema: z.Schema<T, z.ZodTypeDef, any>;
  schemaName?: string;
  schemaDescription?: string;
  mode?: 'auto' | 'json' | 'tool';
  system?: string;
  prompt: string;
  abortSignal?: AbortSignal;
};
/**
 * Stream an object from the LLM with live token-by-token progress.
 *
 * Uses streamObject's fullStream which emits { type: 'text-delta' } events
 * for token-by-token display while streamObject enforces the zod schema
 * (sends it to the model via structured_outputs). This gives both real
 * token streaming AND correct structured output — no manual JSON parsing.
 *
 * Emits llm_chunk events every 10 tokens so the UI can show live progress.
 * Falls back to generateObject if streaming fails.
 */
async function streamObjectWithProgress<T>(
  label: string,
  opts: StreamObjectOptions<T>,
  emit?: (event: ProgressEvent) => void,
): Promise<T> {
  const start = Date.now();
  let tokenCount = 0;
  const elapsedStr = () => ((Date.now() - start) / 1000).toFixed(1);

  try {
    const { fullStream, object } = streamObject(opts);

    // Consume fullStream to get text-delta events for live token display.
    // streamObject handles schema enforcement internally.
    // Also track partial object events for progressive JSON display in UI.
    let lastPartial: unknown;
    let partialCount = 0;
    for await (const event of fullStream) {
      if (event.type === 'text-delta') {
        tokenCount++;
        if (tokenCount % 10 === 0) {
          const elapsed = elapsedStr();
          console.error(`[planner] ${label}: ${tokenCount} tokens in ${elapsed}s...`);
          emit?.({ type: 'llm_chunk', label, chunkIndex: tokenCount, elapsed: Number(elapsed), partial: lastPartial });
        }
      } else if (event.type === 'object') {
        lastPartial = event.object;
        partialCount++;
        // Emit partial object updates for UI progressive display
        if (partialCount % 5 === 0) {
          const elapsed = elapsedStr();
          emit?.({ type: 'llm_chunk', label, chunkIndex: tokenCount, elapsed: Number(elapsed), partial: lastPartial });
        }
      } else if (event.type === 'error') {
        throw event.error;
      }
    }

    const result = await object;
    const elapsed = elapsedStr();
    console.error(`[planner] ${label}: done in ${elapsed}s (${tokenCount} tokens)`);
    emit?.({ type: 'llm_done', label, chunkIndex: tokenCount, elapsed: Number(elapsed) });
    return result;
  } catch (err) {
    const elapsed = elapsedStr();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[planner] ${label}: stream failed in ${elapsed}s (${msg}), falling back to generateObject`);
    emit?.({ type: 'llm_error', label, detail: msg, elapsed: Number(elapsed) });

    // Fallback: non-streaming generateObject
    const result = await generateObject(opts);
    const elapsed2 = elapsedStr();
    console.error(`[planner] ${label}: generateObject fallback done in ${elapsed2}s`);
    emit?.({ type: 'llm_done', label, detail: 'fallback: generateObject', elapsed: Number(elapsed2) });
    return result.object as T;
  }
}

// ============================================================================
// AI story planner
// ============================================================================

export class AIStoryPlanner implements StoryPlannerAdapter {
  private readonly model: LanguageModelV1;

  constructor(model: LanguageModelV1) {
    this.model = model;
  }

  async planStory(input: StoryPlanInput): Promise<StoryPlanOutput> {
    const projectId = input.projectId;
    const text = truncate(input.text, MAX_PASS1_CHARS);

    console.error(`[planner] pass 1/3: world + characters + chapters...`);
    // ---- Pass 1: chapters + scenes + world + characters ----
    // Use generateObject with retry — streamObject can fail silently if the
    // model returns no valid JSON, giving "No object generated" errors.
    let pass1: Pass1Result | null = null;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3 && !pass1; attempt++) {
      try {
        pass1 = await streamObjectWithProgress<Pass1Result>('pass1', {
          model: this.model,
          schema: Pass1Schema,
          schemaName: 'storyPlan',
          schemaDescription: 'Top-level story plan: world, characters, chapters and scenes',
          system: [
            'You are a comic story planner. Decompose an audiobook/source text into a',
            'structured plan suitable for adaptation into a narrated comic.',
            'Identify the world setting, recurring characters, and break the text into',
            'chapters and scenes. Each scene must include a short verbatim textExcerpt',
            'drawn from the source so later passes can extract beats.',
            input.artStyle ? `Target art style: ${input.artStyle}.` : '',
            input.genre && input.genre.length > 0 ? `Genre: ${input.genre.join(', ')}.` : '',
            input.language ? `Source language: ${input.language}.` : '',
          ]
            .filter(Boolean)
            .join(' '),
          prompt: text,
          abortSignal: input.signal,
        }, input.emit);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`[planner] pass 1 failed (attempt ${attempt + 1}/3): ${lastError.message}`);
        if (attempt < 2) {
          // Brief pause before retry
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    if (!pass1) {
      throw lastError ?? new Error('Story planner failed after 3 attempts');
    }

    // ---- Build characters + world bible ----
    const nameToId = new Map<string, string>();
    const characters: CharacterProfile[] = pass1.characters.map((c) => {
      const id = uuid();
      nameToId.set(normaliseName(c.name), id);
      for (const alias of c.aliases) nameToId.set(normaliseName(alias), id);
      return {
        id,
        projectId,
        name: c.name,
        aliases: c.aliases,
        description: c.description,
        role: c.role,
        paletteNotes: c.paletteNotes,
        negativeConstraints: c.negativeConstraints,
        outfitRefs: [],
        locked: false,
      };
    });

    const worldBible: WorldBible = {
      id: uuid(),
      projectId,
      setting: pass1.setting,
      genre: pass1.genre,
      tone: pass1.tone,
      artStyle: pass1.artStyle,
      artStyleNegative: pass1.artStyleNegative,
      colorPalette: pass1.colorPalette,
      worldRules: pass1.worldRules,
    };

    // ---- Build chapter + scene sections, then run pass 2 per scene ----
    const sections: StorySection[] = [];
    const sceneSections: { section: StorySection; excerpt: string; sceneIndex: number }[] = [];

    let chapterIndex = 0;
    for (const chapter of pass1.chapters) {
      const chapterId = uuid();
      sections.push({
        id: chapterId,
        projectId,
        level: 'chapter',
        index: chapterIndex,
        title: chapter.title,
        summary: chapter.summary,
        charactersPresent: [],
        emotionalTone: 'neutral',
        objects: [],
      });

      let sceneIndex = 0;
      for (const scene of chapter.scenes) {
        const sceneId = uuid();
        const sceneSection: StorySection = {
          id: sceneId,
          projectId,
          parentId: chapterId,
          level: 'scene',
          index: sceneIndex,
          title: scene.title,
          summary: scene.summary,
          text: scene.textExcerpt,
          emotionalTone: scene.emotionalTone as EmotionalTone,
          charactersPresent: resolveCharacterIds(scene.charactersPresent, nameToId),
          objects: [],
        };
        sections.push(sceneSection);
        sceneSections.push({
          section: sceneSection,
          excerpt: scene.textExcerpt ?? scene.summary,
          sceneIndex,
        });
        sceneIndex++;
      }
      chapterIndex++;
    }

    console.error(`[planner] pass 2/3: beats for ${sceneSections.length} scene(s) (parallel)...`);
    // ---- Pass 2: beats per scene (parallel) ----
    const beatSectionsByScene = await Promise.all(
      sceneSections.map(async ({ section, excerpt }) => {
        const pass2 = await streamObjectWithProgress<Pass2Result>(`pass2/scene${sceneSections.findIndex(s => s.section.id === section.id)}`, {
          model: this.model,
          schema: Pass2Schema,
          schemaName: 'sceneBeats',
          schemaDescription: 'Beat-level decomposition of a single scene',
          system:
            'You are a comic beat breakdown assistant. Split the given scene into a sequence of' +
            ' narrative beats. Each beat is one visual moment that will become one or more panels.' +
            ' Preserve the scene emotional tone unless a beat clearly shifts it.',
          prompt: `Scene summary: ${section.summary}\n\nSource excerpt:\n${excerpt}`,
          abortSignal: input.signal,
        }, input.emit);
        return { section, beats: pass2.beats };
      }),
    );

    // ---- Build beat sections + run pass 3 per scene ----
    const panelHints: PanelHint[] = [];
    const beatSectionLookup: { beatIndex: number; section: StorySection }[] = [];

    for (const { section, beats } of beatSectionsByScene) {
      beats.forEach((beat, beatIndex) => {
        const beatId = uuid();
        const beatSection: StorySection = {
          id: beatId,
          projectId,
          parentId: section.id,
          level: 'beat',
          index: beatIndex,
          summary: beat.summary,
          text: beat.text,
          emotionalTone: beat.emotionalTone as EmotionalTone,
          cameraHint: beat.cameraHint as CameraFraming | undefined,
          charactersPresent: resolveCharacterIds(beat.charactersPresent, nameToId),
          objects: beat.objects,
        };
        sections.push(beatSection);
        beatSectionLookup.push({ beatIndex, section: beatSection });
      });
    }

    const totalBeats = beatSectionsByScene.reduce((n, { beats }) => n + beats.length, 0);
    console.error(`[planner] pass 3/3: panel hints for ${totalBeats} beat(s) across ${beatSectionsByScene.length} scene(s) (parallel)...`);
    // ---- Pass 3: page/panel allocation hints per scene (parallel) ----
    const panelsPerBeat = input.panelsPerBeat ?? 1;
    const pass3Results = await Promise.all(
      beatSectionsByScene.map(async ({ section, beats }) => {
        if (beats.length === 0) return { section, panels: [] as Pass3Result['panels'] };
        const sceneIdx = beatSectionsByScene.findIndex(s => s.section.id === section.id);
        const pass3 = await streamObjectWithProgress<Pass3Result>(`pass3/scene${sceneIdx}`, {
          model: this.model,
          schema: Pass3Schema,
          schemaName: 'panelHints',
          schemaDescription: 'Page/panel allocation hints for each beat in a scene',
          system:
            `You are a comic layout planner. For each beat, propose ${panelsPerBeat} panel(s).` +
            ' Describe the visual content, camera framing, which characters appear and their pose/expression,' +
            ' and any dialogue/narration lines. beatIndex must match the supplied beat list order (0-based).',
          prompt: beats
            .map(
              (b, i) =>
                `Beat ${i}: ${b.summary}` +
                (b.cameraHint ? ` [camera: ${b.cameraHint}]` : '') +
                (b.charactersPresent.length > 0 ? ` (characters: ${b.charactersPresent.join(', ')})` : ''),
            )
            .join('\n'),
          abortSignal: input.signal,
        }, input.emit);
        return { section, panels: pass3.panels };
      }),
    );

    // ---- Map pass 3 panels to PanelHints ----
    for (const { panels } of pass3Results) {
      for (const panel of panels) {
        const beat = beatSectionLookup.find((b) => b.beatIndex === panel.beatIndex);
        if (!beat) continue;
        panelHints.push({
          beatSectionId: beat.section.id,
          beatIndex: panel.beatIndex,
          description: panel.description,
          cameraFraming: panel.cameraFraming as CameraFraming | undefined,
          characters: panel.characters,
          dialogueLines: panel.dialogueLines,
        });
      }
    }

    console.error(`[planner] done: ${sections.length} sections, ${characters.length} characters, ${panelHints.length} panel hints`);
    return { sections, characters, worldBible, panelHints };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createStoryPlanner(
  provider: LLMProvider,
  model: string,
  env: Env,
): StoryPlannerAdapter {
  return new AIStoryPlanner(resolveLanguageModel(provider, model, env));
}
