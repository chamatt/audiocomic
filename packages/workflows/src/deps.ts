import { getEnv } from '@audiocomic/shared';
import type { PipelineDeps, PipelineRepo, StoryPlanInput, StoryPlanOutput, PromptComposeInput, ParsedBook } from './pipeline.js';
import type {
  JobRecord,
  Project,
  ProjectStage,
  StageState,
  TranscriptChunk,
  SpeakerTurn,
  StorySection,
  CharacterProfile,
  SceneProfile,
  ObjectProfile,
  WorldBible,
  PageSpec,
  PanelSpec,
  PanelRenderRequest,
  PanelRenderResult,
  PageComposite,
  LetteringSpec,
  NarrationTimeline,
  ExportBundle,
  SourceAsset,
  RenderPreset,
} from '@audiocomic/domain';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';

// ============================================================================
// Pipeline dependency wiring — connects all adapter packages
// ============================================================================

export async function createPipelineDeps(): Promise<PipelineDeps> {
  const env = getEnv();

  // Lazy import the db package
  const { createDb, createRepository } = await import('@audiocomic/db');
  const db = createDb(env.DATABASE_URL);
  const repo = createRepository(db) as unknown as PipelineRepo & {
    claimNextJob(): Promise<JobRecord | null>;
    updateJob(id: string, patch: Partial<JobRecord>): Promise<void>;
    updateProjectStage(projectId: string, stage: ProjectStage, state: StageState, error?: string): Promise<void>;
  };

  // Lazy import the ai package
  const ai = await import('@audiocomic/ai');

  // Lazy import the renderers package
  const renderers = await import('@audiocomic/renderers');

  // Lazy import the media package
  const media = await import('@audiocomic/media');

  // Storage helpers (local filesystem for MVP)
  const uploadDir = env.UPLOAD_DIR;
  const exportDir = env.EXPORT_DIR;

  async function ensureDir(path: string): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true });
  }

  function localPath(key: string): string {
    return join(uploadDir, key);
  }

  const storage = {
    async readAsset(key: string): Promise<Buffer> {
      return fs.readFile(localPath(key));
    },
    async writeAsset(key: string, data: Buffer): Promise<void> {
      const path = localPath(key);
      await ensureDir(path);
      await fs.writeFile(path, data);
    },
    async assetExists(key: string): Promise<boolean> {
      try {
        await fs.access(localPath(key));
        return true;
      } catch {
        return false;
      }
    },
  };

  // Create adapters based on env config
  const transcriptionAdapter = ai.createTranscriptionAdapter(
    env.OPENAI_API_KEY ? 'openai' : 'placeholder',
    env,
  );
  const storyPlanner = ai.createStoryPlanner(
    env.OPENAI_API_KEY ? 'openai' : 'placeholder',
    env.DEFAULT_LLM_MODEL,
    env,
  );
  const ttsAdapter = env.OPENAI_API_KEY ? ai.createTTSAdapter('openai', env) : undefined;
  const renderer = renderers.createRenderer(env.DEFAULT_RENDERER, env);

  return {
    readAsset: storage.readAsset,
    writeAsset: storage.writeAsset,
    assetExists: storage.assetExists,

    repo,

    async transcribe(audioPath: string) {
      const result = await transcriptionAdapter.transcribe(audioPath);
      return {
        chunks: result.chunks,
        durationSec: result.durationSec ?? 0,
      };
    },

    async diarize(audioPath: string, chunks: TranscriptChunk[]): Promise<SpeakerTurn[]> {
      if (transcriptionAdapter.diarize) {
        return transcriptionAdapter.diarize(audioPath, chunks);
      }
      return [];
    },

    async planStory(input: StoryPlanInput): Promise<StoryPlanOutput> {
      return storyPlanner.planStory(input);
    },

    async synthesizeTTS(text: string, opts?: { voice?: string }) {
      if (!ttsAdapter) throw new Error('TTS adapter not configured');
      return ttsAdapter.synthesize(text, opts);
    },

    async composePrompt(input: PromptComposeInput): Promise<string> {
      return ai.composePanelPrompt(
        input.panel,
        input.section,
        input.characters,
        input.worldBible,
        input.sectionMemory,
      );
    },

    async renderPanel(req: PanelRenderRequest): Promise<PanelRenderResult> {
      return renderer.render(req);
    },

    async parseTextBook(content: string): Promise<ParsedBook> {
      const result = media.parseTextBook(content);
      return {
        chapters: result.chapters.map((ch) => ({
          title: ch.title,
          text: ch.text,
          wordStart: ch.wordStart,
          wordEnd: ch.wordEnd,
        })),
      };
    },

    async probeAudio(path: string) {
      const result = await media.probeAudio(path);
      return { durationSec: result.duration };
    },

    async composePage(
      panelImages: Buffer[],
      pageSpec: PageSpec,
      panelSpecs: PanelSpec[],
      size: { width: number; height: number },
    ): Promise<Buffer> {
      return media.composePage(panelImages, pageSpec, panelSpecs, size);
    },

    async renderLettering(
      spec: LetteringSpec,
      pageWidth: number,
      pageHeight: number,
    ): Promise<string> {
      return media.renderLetteringOverlay(spec, pageWidth, pageHeight);
    },

    async exportMotionComic(
      timeline: NarrationTimeline,
      pageImages: Map<string, string>,
      audioPath: string | undefined,
      outputPath: string,
    ) {
      // Read page images from storage
      const imageMap = new Map<string, Buffer | string>();
      for (const [pageId, key] of pageImages) {
        imageMap.set(pageId, await storage.readAsset(key));
      }
      await ensureDir(outputPath);
      const result = await media.exportMotionComic(
        timeline,
        imageMap,
        audioPath ? localPath(audioPath) : undefined,
        outputPath,
        env,
      );
      return { sizeBytes: result.sizeBytes, durationSec: result.durationSec };
    },

    async exportPageBundle(pageImages: string[], outputPath: string) {
      // Read images from storage and pass paths
      const localPaths: string[] = [];
      for (const key of pageImages) {
        localPaths.push(localPath(key));
      }
      await ensureDir(outputPath);
      const result = await media.exportPageBundle(localPaths, outputPath);
      return { sizeBytes: result.sizeBytes };
    },
  };
}
