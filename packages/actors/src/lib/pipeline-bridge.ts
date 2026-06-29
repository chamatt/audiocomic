// Bridge between Rivet actor step executors and the real adapter packages.
// Each step executor calls adapters directly via this bridge — no monolithic
// pipeline handler involved. The actor system IS the pipeline orchestrator.

import { Context, Effect, Layer } from "effect";
import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";

import { createMediaManagerFromEnv, type MediaManager } from "@audiocomic/storage";
import {
  createAgentHandles,
  buildModelConfig,
  type StoryPlannerAgentHandle,
  type BibleBuilderAgentHandle,
} from "../agents/index.ts";
import { createEmbeddingProvider } from "@audiocomic/knowledge";

import { createRepository, type Repository, type CreateDbResult } from "@audiocomic/db";
import type { Env } from "@audiocomic/shared";

import type {
  TranscriptionAdapter,
  StoryPlannerAdapter,
  TTSAdapter,
  LLMProvider,
  TranscriptionProvider,
} from "@audiocomic/ai";
import {
  createTranscriptionAdapter,
  createStoryPlanner,
  createTTSAdapter,
  composePanelPrompt,
  composeNegativePrompt,
} from "@audiocomic/ai";

import type { RendererAdapter } from "@audiocomic/renderers";
import { createRenderer } from "@audiocomic/renderers";

import {
  probeAudio as mediaProbeAudio,
  parseTextBook as mediaParseTextBook,
  composePage as mediaComposePage,
  renderLetteringOverlay as mediaRenderLettering,
  exportMotionComic as mediaExportMotionComic,
  exportPageBundle as mediaExportPageBundle,
} from "@audiocomic/media";

// ============================================================================
// Pipeline bridge shape — what step executors consume
// ============================================================================

export interface PipelineBridgeShape {
  readonly repo: Repository;
  readonly env: Env;
  readonly storage: {
    readAsset(key: string): Promise<Buffer>;
    writeAsset(key: string, data: Buffer): Promise<void>;
    assetExists(key: string): Promise<boolean>;
    deleteAsset(key: string): Promise<void>;
    downloadStream(key: string): Promise<ReadableStream<Uint8Array>>;
    uploadStream(key: string, stream: ReadableStream<Uint8Array>, mimeType: string): Promise<void>;
    size(key: string): Promise<number>;
  };
  readonly mediaManager: MediaManager;
  getTranscriptionAdapter(): TranscriptionAdapter;
  getStoryPlanner(): StoryPlannerAdapter;
  /** Get or create a Mastra story planner agent bound to a project's knowledge base. */
  getStoryPlannerAgent(projectId: string): Promise<import("../agents/index.ts").StoryPlannerAgentHandle>;
  /** Get or create a Mastra bible builder agent bound to a project's knowledge base. */
  getBibleBuilderAgent(projectId: string): Promise<import("../agents/index.ts").BibleBuilderAgentHandle>;
  getTTSAdapter(): TTSAdapter | null;
  getRenderer(): RendererAdapter;
  probeAudio(path: string): Promise<{ durationSec: number }>;
  parseTextBook(
    content: string,
  ): Promise<{ chapters: { title: string; text: string; wordStart: number; wordEnd: number }[] }>;
  composePage(
    panelImages: Buffer[],
    pageSpec: unknown,
    panelSpecs: unknown[],
    size: { width: number; height: number },
  ): Promise<Buffer>;
  renderLettering(spec: unknown, pageWidth: number, pageHeight: number): Promise<string>;
  exportMotionComic(
    timeline: unknown,
    pageImages: Map<string, Buffer | string>,
    audioPath: string | undefined,
    outputPath: string,
  ): Promise<{ sizeBytes: number; durationSec: number }>;
  exportPageBundle(pageImagePaths: string[], outputPath: string): Promise<{ sizeBytes: number }>;
  composePanelPrompt(
    panel: unknown,
    section: unknown,
    characters: unknown[],
    worldBible: unknown,
    sectionMemoryOrAllSections?: string | unknown[],
  ): string;
  composeNegativePrompt(panel: unknown, characters: unknown[], worldBible: unknown): string;
}

export const PipelineBridge = Context.Service<PipelineBridgeShape>("PipelineBridge");

// ============================================================================
// Factory — creates a real bridge from env + db
// ============================================================================

export function makePipelineBridgeLayer(
  dbResult: CreateDbResult,
  env: Env,
): Layer.Layer<PipelineBridgeShape> {
  const repo = createRepository(dbResult.db);
  const exportDir = env.EXPORT_DIR;

  // MediaManager — S3-compatible storage (MinIO or local filesystem fallback)
  const mediaManager = createMediaManagerFromEnv(env);

  const storage = {
    async readAsset(key: string): Promise<Buffer> {
      return mediaManager.downloadBuffer(key);
    },
    async writeAsset(key: string, data: Buffer): Promise<void> {
      await mediaManager.upload(key, data, "application/octet-stream");
    },
    async assetExists(key: string): Promise<boolean> {
      return mediaManager.exists(key);
    },
    async deleteAsset(key: string): Promise<void> {
      await mediaManager.delete(key);
    },
    async downloadStream(key: string): Promise<ReadableStream<Uint8Array>> {
      return mediaManager.download(key);
    },
    async uploadStream(
      key: string,
      stream: ReadableStream<Uint8Array>,
      mimeType: string,
    ): Promise<void> {
      await mediaManager.upload(key, stream, mimeType);
    },
    async size(key: string): Promise<number> {
      return mediaManager.size(key);
    },
  };

  const llmProvider: LLMProvider =
    env.LLM_PROVIDER ?? (env.OPENROUTER_API_KEY
      ? "openrouter"
      : env.OPENAI_API_KEY
        ? "openai"
        : env.ANTHROPIC_API_KEY
          ? "anthropic"
          : env.GOOGLE_GENERATIVE_AI_API_KEY
            ? "google"
            : "openrouter");
  const transcriptionProvider: TranscriptionProvider = env.GROQ_API_KEY
    ? "groq"
    : env.OPENAI_API_KEY
      ? "openai"
      : "groq";

  let transcriptionAdapter: TranscriptionAdapter | null = null;
  let storyPlanner: StoryPlannerAdapter | null = null;
  let ttsAdapter: TTSAdapter | null | undefined = undefined;
  const renderer = createRenderer(env.DEFAULT_RENDERER, env);

  // Per-project agent cache — agents are created on first access and reused
  const storyPlannerAgents = new Map<string, StoryPlannerAgentHandle>();
  const bibleBuilderAgents = new Map<string, BibleBuilderAgentHandle>();

  const bridge: PipelineBridgeShape = {
    repo,
    env,
    storage,
    mediaManager,
    getTranscriptionAdapter() {
      if (!transcriptionAdapter)
        transcriptionAdapter = createTranscriptionAdapter(transcriptionProvider, env);
      return transcriptionAdapter;
    },
    getStoryPlanner() {
      if (!storyPlanner) storyPlanner = createStoryPlanner(llmProvider, env.DEFAULT_LLM_MODEL, env);
      return storyPlanner;
    },
    async getStoryPlannerAgent(projectId: string) {
      let agent = storyPlannerAgents.get(projectId);
      if (!agent) {
        const embedder = createEmbeddingProvider(env);
        const project = await repo.projects.getById(projectId);
        const modelConfig = buildModelConfig(project?.llmProvider, project?.llmModel);
        const handles = createAgentHandles({
          repo,
          embedder,
          db: dbResult.db,
          projectId,
          modelConfig,
        });
        agent = handles.storyPlanner;
        storyPlannerAgents.set(projectId, agent);
        bibleBuilderAgents.set(projectId, handles.bibleBuilder);
      }
      return agent;
    },
    async getBibleBuilderAgent(projectId: string) {
      let agent = bibleBuilderAgents.get(projectId);
      if (!agent) {
        const embedder = createEmbeddingProvider(env);
        const project = await repo.projects.getById(projectId);
        const modelConfig = buildModelConfig(project?.llmProvider, project?.llmModel);
        const handles = createAgentHandles({
          repo,
          embedder,
          db: dbResult.db,
          projectId,
          modelConfig,
        });
        agent = handles.bibleBuilder;
        bibleBuilderAgents.set(projectId, agent);
        storyPlannerAgents.set(projectId, handles.storyPlanner);
      }
      return agent;
    },
    getTTSAdapter() {
      if (ttsAdapter === undefined) {
        ttsAdapter = env.OPENAI_API_KEY ? createTTSAdapter("openai", env) : null;
      }
      return ttsAdapter;
    },
    getRenderer() {
      return renderer;
    },
    async probeAudio(path: string) {
      const result = await mediaProbeAudio(path);
      return { durationSec: result.duration };
    },
    async parseTextBook(content: string) {
      const result = mediaParseTextBook(content);
      return {
        chapters: result.chapters.map((ch) => ({
          title: ch.title,
          text: ch.text,
          wordStart: ch.wordStart,
          wordEnd: ch.wordEnd,
        })),
      };
    },
    async composePage(
      panelImages: Buffer[],
      pageSpec: unknown,
      panelSpecs: unknown[],
      size: { width: number; height: number },
    ) {
      return mediaComposePage(panelImages, pageSpec as never, panelSpecs as never, size);
    },
    async renderLettering(spec: unknown, pageWidth: number, pageHeight: number) {
      return mediaRenderLettering(spec as never, pageWidth, pageHeight);
    },
    async exportMotionComic(
      timeline: unknown,
      pageImages: Map<string, Buffer | string>,
      audioPath: string | undefined,
      outputPath: string,
    ) {
      const result = await mediaExportMotionComic(
        timeline as never,
        pageImages,
        audioPath,
        outputPath,
        { ffmpegBin: env.FFMPEG_BIN },
      );
      return { sizeBytes: result.sizeBytes, durationSec: result.durationSec };
    },
    async exportPageBundle(pageImagePaths: string[], outputPath: string) {
      const result = await mediaExportPageBundle(pageImagePaths, outputPath);
      return { sizeBytes: result.sizeBytes };
    },
    composePanelPrompt(
      panel: unknown,
      section: unknown,
      characters: unknown[],
      worldBible: unknown,
      sectionMemoryOrAllSections?: string | unknown[],
    ) {
      return composePanelPrompt(
        panel as never,
        section as never,
        characters as never,
        worldBible as never,
        sectionMemoryOrAllSections as never,
      );
    },
    composeNegativePrompt(panel: unknown, characters: unknown[], worldBible: unknown) {
      return composeNegativePrompt(panel as never, characters as never, worldBible as never);
    },
  };

  return Layer.succeed(PipelineBridge, bridge);
}
