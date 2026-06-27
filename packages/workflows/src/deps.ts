import { getEnv } from '@audiocomic/shared';
import type { PipelineDeps, PipelineRepo, StoryPlanInput, StoryPlanOutput, PromptComposeInput, ParsedBook } from './pipeline';
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
import type { StoryPlanInput as AIStoryPlanInput, LLMProvider, TranscriptionProvider, TranscriptionAdapter, StoryPlannerAdapter, TTSAdapter } from '@audiocomic/ai';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';

// ============================================================================
// Pipeline dependency wiring — connects all adapter packages
// ============================================================================

/** Convert snake_case keys to camelCase for raw SQL results. */
function snakeToCamel(row: unknown): Record<string, unknown> {
  if (typeof row !== 'object' || row === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (value === null) {
      out[camelKey] = undefined;
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
      out[camelKey] = value.replace(' ', 'T').replace(/\+00$/, 'Z');
    } else {
      out[camelKey] = value;
    }
  }
  return out;
}

export async function createPipelineDeps(): Promise<PipelineDeps> {
  const env = getEnv();

  // Lazy import the db package
  const { createDb, createRepository } = await import('@audiocomic/db');
  const dbResult = createDb(env.DATABASE_URL);
  const raw = createRepository(dbResult.db);

  // Adapt the db package's entity-per-repo structure to PipelineRepo's
  // flat method interface. Also handles createMany via Promise.all and
  // maps getByProjectId → get*ByProject naming.
  const repo: PipelineRepo = {
    getProject: (id) => raw.projects.getById(id),
    updateProject: (id, patch) => raw.projects.patch(id, patch).then(() => undefined),
    getAssetsByProject: (pid) => raw.sourceAssets.getByProjectId(pid),
    createTranscriptChunks: (chunks) => Promise.all(chunks.map((c) => raw.transcriptChunks.create(c))).then(() => undefined),
    getTranscriptChunks: (pid) => raw.transcriptChunks.getByProjectId(pid),
    createSpeakerTurns: (turns) => Promise.all(turns.map((t) => raw.speakerTurns.create(t))).then(() => undefined),
    createStorySections: (sections) => Promise.all(sections.map((s) => raw.storySections.create(s))).then(() => undefined),
    getStorySections: (pid) => raw.storySections.getByProjectId(pid),
    createCharacters: (chars) => Promise.all(chars.map((c) => raw.characterProfiles.create(c))).then(() => undefined),
    getCharacters: (pid) => raw.characterProfiles.getByProjectId(pid),
    createScenes: (scenes) => Promise.all(scenes.map((s) => raw.sceneProfiles.create(s))).then(() => undefined),
    createObjects: (objects) => Promise.all(objects.map((o) => raw.objectProfiles.create(o))).then(() => undefined),
    createWorldBible: (bible) => raw.worldBibles.create(bible).then(() => undefined),
    getWorldBible: async (pid) => {
      const bibles = await raw.worldBibles.getByProjectId(pid);
      return bibles[0] ?? null;
    },
    createPages: (pages) => Promise.all(pages.map((p) => raw.pageSpecs.create(p))).then(() => undefined),
    getPages: (pid) => raw.pageSpecs.getByProjectId(pid),
    updatePage: (id, patch) => raw.pageSpecs.patch(id, patch).then(() => undefined),
    createPanels: (panels) => Promise.all(panels.map((p) => raw.panelSpecs.create(p))).then(() => undefined),
    getPanelsByPage: async (pageId) => {
      const rows = await dbResult.sql`SELECT * FROM panel_specs WHERE page_id = ${pageId} ORDER BY index ASC`;
      return (rows as unknown[]).map(snakeToCamel) as unknown as PanelSpec[];
    },
    getPanelsByProject: (pid) => raw.panelSpecs.getByProjectId(pid),
    updatePanel: (id, patch) => raw.panelSpecs.patch(id, patch).then(() => undefined),
    createRenderRequest: (req) => raw.panelRenderRequests.create(req).then(() => undefined),
    createRenderResult: (result) => raw.panelRenderResults.create(result).then(() => undefined),
    getRenderResultsByPanel: async (panelId) => {
      const rows = await dbResult.sql`SELECT * FROM panel_render_results WHERE panel_id = ${panelId} ORDER BY created_at DESC`;
      return (rows as unknown[]).map(snakeToCamel) as unknown as PanelRenderResult[];
    },
    createComposite: (comp) => raw.pageComposites.create(comp).then(() => undefined),
    getCompositesByProject: (pid) => raw.pageComposites.getByProjectId(pid),
    createLettering: (spec) => raw.letteringSpecs.create(spec).then(() => undefined),
    createTimeline: (timeline) => raw.narrationTimelines.create(timeline).then(() => undefined),
    getTimeline: async (pid) => {
      const timelines = await raw.narrationTimelines.getByProjectId(pid);
      return timelines[0] ?? null;
    },
    createExport: (bundle) => raw.exportBundles.create(bundle).then(() => undefined),
    getRenderPreset: (id) => raw.renderPresets.getById(id),
    claimNextJob: () => raw.claimNextJob(),
    updateJob: (id, patch) => raw.jobs.patch(id, patch).then(() => undefined),
    updateProjectStage: (pid, stage, state, error) => raw.updateProjectStage(pid, stage, state, error),
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

  // Adapter creation is deferred to first use so the worker boots without
  // API keys. Jobs that need a missing key fail at execution time with a
  // helpful error, rather than crashing the worker at startup.
  const llmProvider: LLMProvider = env.OPENAI_API_KEY ? 'openai' : env.ANTHROPIC_API_KEY ? 'anthropic' : env.GOOGLE_GENERATIVE_AI_API_KEY ? 'google' : 'openai';
  const transcriptionProvider: TranscriptionProvider = env.OPENAI_API_KEY ? 'openai' : env.GROQ_API_KEY ? 'groq' : 'openai';

  let transcriptionAdapter: TranscriptionAdapter | null = null;
  function getTranscriptionAdapter(): TranscriptionAdapter {
    if (!transcriptionAdapter) transcriptionAdapter = ai.createTranscriptionAdapter(transcriptionProvider, env);
    return transcriptionAdapter;
  }

  let storyPlanner: StoryPlannerAdapter | null = null;
  function getStoryPlanner(): StoryPlannerAdapter {
    if (!storyPlanner) storyPlanner = ai.createStoryPlanner(llmProvider, env.DEFAULT_LLM_MODEL, env);
    return storyPlanner;
  }

  let ttsAdapter: TTSAdapter | null | undefined = undefined; // undefined = not decided, null = disabled
  function getTTSAdapter(): TTSAdapter | null {
    if (ttsAdapter === undefined) {
      ttsAdapter = env.OPENAI_API_KEY ? ai.createTTSAdapter('openai', env) : null;
    }
    return ttsAdapter;
  }

  const renderer = renderers.createRenderer(env.DEFAULT_RENDERER, env);

  return {
    readAsset: storage.readAsset,
    writeAsset: storage.writeAsset,
    assetExists: storage.assetExists,

    repo,

    async transcribe(audioPath: string) {
      const result = await getTranscriptionAdapter().transcribe(audioPath, {
        projectId: '', // projectId is tracked by the pipeline, not the adapter
      });
      return {
        chunks: result.chunks,
        durationSec: result.durationSec ?? 0,
      };
    },

    async diarize(_audioPath: string, _chunks: TranscriptChunk[]): Promise<SpeakerTurn[]> {
      // Diarization is optional and requires a separate adapter (pyannote etc.)
      // For MVP, we skip diarization — the pipeline works without speaker attribution.
      return [];
    },

    async planStory(input: StoryPlanInput): Promise<StoryPlanOutput> {
      // Map our pipeline input to the AI package's input format
      const aiInput: AIStoryPlanInput = {
        projectId: input.projectId,
        text: input.text,
      };
      const aiResult = await getStoryPlanner().planStory(aiInput);
      // Map the AI package's output back to our pipeline output format
      return {
        sections: aiResult.sections,
        characters: aiResult.characters,
        scenes: [], // AI planner doesn't produce separate scene profiles
        objects: [], // AI planner doesn't produce separate object profiles
        worldBible: aiResult.worldBible,
      };
    },

    async synthesizeTTS(text: string, opts?: { voice?: string }) {
      const adapter = getTTSAdapter();
      if (!adapter) throw new Error('TTS adapter not configured (OPENAI_API_KEY required)');
      return adapter.synthesize(text, opts);
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
        { ffmpegBin: env.FFMPEG_BIN },
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
