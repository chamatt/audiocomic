// Bridge between Rivet actor step executors and the real adapter packages.
// Each step executor calls adapters directly via this bridge — no monolithic
// pipeline handler involved. The actor system IS the pipeline orchestrator.

import { Context, Effect, Layer } from "effect";
import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";

import { createRepository, type Repository, type CreateDbResult } from "@audiocomic/db";
import type { Env } from "@audiocomic/shared";

import type {
	TranscriptionAdapter,
	StoryPlannerAdapter,
	TTSAdapter,
	LLMProvider,
	TranscriptionProvider,
} from "@audiocomic/ai";
import { createTranscriptionAdapter, createStoryPlanner, createTTSAdapter, composePanelPrompt } from "@audiocomic/ai";

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
	};
	getTranscriptionAdapter(): TranscriptionAdapter;
	getStoryPlanner(): StoryPlannerAdapter;
	getTTSAdapter(): TTSAdapter | null;
	getRenderer(): RendererAdapter;
	probeAudio(path: string): Promise<{ durationSec: number }>;
	parseTextBook(content: string): Promise<{ chapters: { title: string; text: string; wordStart: number; wordEnd: number }[] }>;
	composePage(panelImages: Buffer[], pageSpec: unknown, panelSpecs: unknown[], size: { width: number; height: number }): Promise<Buffer>;
	renderLettering(spec: unknown, pageWidth: number, pageHeight: number): Promise<string>;
	exportMotionComic(timeline: unknown, pageImages: Map<string, Buffer | string>, audioPath: string | undefined, outputPath: string): Promise<{ sizeBytes: number; durationSec: number }>;
	exportPageBundle(pageImagePaths: string[], outputPath: string): Promise<{ sizeBytes: number }>;
	composePanelPrompt(panel: unknown, section: unknown, characters: unknown[], worldBible: unknown, sectionMemory?: string): string;
}

export const PipelineBridge = Context.Service<PipelineBridgeShape>("PipelineBridge");

// ============================================================================
// Factory — creates a real bridge from env + db
// ============================================================================

export function makePipelineBridgeLayer(dbResult: CreateDbResult, env: Env): Layer.Layer<PipelineBridgeShape> {
	const repo = createRepository(dbResult.db);
	const uploadDir = env.UPLOAD_DIR;
	const exportDir = env.EXPORT_DIR;

	function localPath(key: string): string {
		return join(uploadDir, key);
	}

	async function ensureDir(path: string): Promise<void> {
		await fs.mkdir(dirname(path), { recursive: true });
	}

	const storage = {
		async readAsset(key: string): Promise<Buffer> {
			return fs.readFile(localPath(key));
		},
		async writeAsset(key: string, data: Buffer): Promise<void> {
			const p = localPath(key);
			await ensureDir(p);
			await fs.writeFile(p, data);
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

	const llmProvider: LLMProvider = env.OPENAI_API_KEY ? "openai" : env.ANTHROPIC_API_KEY ? "anthropic" : env.GOOGLE_GENERATIVE_AI_API_KEY ? "google" : "openai";
	const transcriptionProvider: TranscriptionProvider = env.OPENAI_API_KEY ? "openai" : env.GROQ_API_KEY ? "groq" : "openai";

	let transcriptionAdapter: TranscriptionAdapter | null = null;
	let storyPlanner: StoryPlannerAdapter | null = null;
	let ttsAdapter: TTSAdapter | null | undefined = undefined;
	const renderer = createRenderer(env.DEFAULT_RENDERER, env);

	const bridge: PipelineBridgeShape = {
		repo,
		env,
		storage,
		getTranscriptionAdapter() {
			if (!transcriptionAdapter) transcriptionAdapter = createTranscriptionAdapter(transcriptionProvider, env);
			return transcriptionAdapter;
		},
		getStoryPlanner() {
			if (!storyPlanner) storyPlanner = createStoryPlanner(llmProvider, env.DEFAULT_LLM_MODEL, env);
			return storyPlanner;
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
		async composePage(panelImages: Buffer[], pageSpec: unknown, panelSpecs: unknown[], size: { width: number; height: number }) {
			return mediaComposePage(panelImages, pageSpec as never, panelSpecs as never, size);
		},
		async renderLettering(spec: unknown, pageWidth: number, pageHeight: number) {
			return mediaRenderLettering(spec as never, pageWidth, pageHeight);
		},
		async exportMotionComic(timeline: unknown, pageImages: Map<string, Buffer | string>, audioPath: string | undefined, outputPath: string) {
			const result = await mediaExportMotionComic(timeline as never, pageImages, audioPath, outputPath, { ffmpegBin: env.FFMPEG_BIN });
			return { sizeBytes: result.sizeBytes, durationSec: result.durationSec };
		},
		async exportPageBundle(pageImagePaths: string[], outputPath: string) {
			const result = await mediaExportPageBundle(pageImagePaths, outputPath);
			return { sizeBytes: result.sizeBytes };
		},
		composePanelPrompt(panel: unknown, section: unknown, characters: unknown[], worldBible: unknown, sectionMemory?: string) {
			return composePanelPrompt(panel as never, section as never, characters as never, worldBible as never, sectionMemory);
		},
	};

	return Layer.succeed(PipelineBridge, bridge);
}
