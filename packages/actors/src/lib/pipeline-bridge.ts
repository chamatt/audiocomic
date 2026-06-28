// Bridge between Rivet actor step executors and the existing @audiocomic/workflows pipeline.
// This allows step executors to call the real AI/media/renderer adapters without duplicating them.

import { Context, Effect, Layer } from "effect";

// ============================================================================
// Pipeline bridge service — provides access to existing workflow adapters
// ============================================================================

export interface PipelineBridgeShape {
	// The bridge is initialized at server startup with real adapters
	// Step executors call these methods to invoke existing pipeline logic
	transcribe: (audioPath: string) => Effect.Effect<{ chunks: unknown[]; durationSec: number }, Error>;
	planStory: (input: unknown) => Effect.Effect<unknown, Error>;
	composePrompt: (input: unknown) => Effect.Effect<string, Error>;
	renderPanel: (req: unknown) => Effect.Effect<unknown, Error>;
	probeAudio: (path: string) => Effect.Effect<{ durationSec: number }, Error>;
	parseTextBook: (content: string) => Effect.Effect<unknown, Error>;
	composePage: (panelImages: Buffer[], pageSpec: unknown, panelSpecs: unknown[], size: unknown) => Effect.Effect<Buffer, Error>;
	exportMotionComic: (timeline: unknown, pageImages: Map<string, string>, audioPath: string | undefined, outputPath: string) => Effect.Effect<{ sizeBytes: number; durationSec: number }, Error>;
	exportPageBundle: (pageImages: string[], outputPath: string) => Effect.Effect<{ sizeBytes: number }, Error>;
}

export const PipelineBridge = Context.Service<PipelineBridgeShape>("PipelineBridge");

// Placeholder live layer — will be replaced at server startup with real adapters
export const PipelineBridgeLive = Layer.succeed(PipelineBridge, {
	transcribe: (_audioPath: string) => Effect.fail(new Error("PipelineBridge not initialized — start server with real adapters")),
	planStory: (_input: unknown) => Effect.fail(new Error("PipelineBridge not initialized")),
	composePrompt: (_input: unknown) => Effect.fail(new Error("PipelineBridge not initialized")),
	renderPanel: (_req: unknown) => Effect.fail(new Error("PipelineBridge not initialized")),
	probeAudio: (_path: string) => Effect.fail(new Error("PipelineBridge not initialized")),
	parseTextBook: (_content: string) => Effect.fail(new Error("PipelineBridge not initialized")),
	composePage: (_panelImages: Buffer[], _pageSpec: unknown, _panelSpecs: unknown[], _size: unknown) => Effect.fail(new Error("PipelineBridge not initialized")),
	exportMotionComic: (_timeline: unknown, _pageImages: Map<string, string>, _audioPath: string | undefined, _outputPath: string) => Effect.fail(new Error("PipelineBridge not initialized")),
	exportPageBundle: (_pageImages: string[], _outputPath: string) => Effect.fail(new Error("PipelineBridge not initialized")),
});

// Helper to create a real bridge from existing workflow deps
export function makePipelineBridgeLayer(deps: {
	transcribe: (audioPath: string) => Promise<{ chunks: unknown[]; durationSec: number }>;
	planStory: (input: unknown) => Promise<unknown>;
	composePrompt: (input: unknown) => Promise<string>;
	renderPanel: (req: unknown) => Promise<unknown>;
	probeAudio: (path: string) => Promise<{ durationSec: number }>;
	parseTextBook: (content: string) => Promise<unknown>;
	composePage: (panelImages: Buffer[], pageSpec: unknown, panelSpecs: unknown[], size: unknown) => Promise<Buffer>;
	exportMotionComic: (timeline: unknown, pageImages: Map<string, string>, audioPath: string | undefined, outputPath: string) => Promise<{ sizeBytes: number; durationSec: number }>;
	exportPageBundle: (pageImages: string[], outputPath: string) => Promise<{ sizeBytes: number }>;
}): Layer.Layer<PipelineBridgeShape> {
	return Layer.succeed(PipelineBridge, {
		transcribe: (audioPath: string) => Effect.tryPromise(() => deps.transcribe(audioPath)),
		planStory: (input: unknown) => Effect.tryPromise(() => deps.planStory(input)),
		composePrompt: (input: unknown) => Effect.tryPromise(() => deps.composePrompt(input)),
		renderPanel: (req: unknown) => Effect.tryPromise(() => deps.renderPanel(req)),
		probeAudio: (path: string) => Effect.tryPromise(() => deps.probeAudio(path)),
		parseTextBook: (content: string) => Effect.tryPromise(() => deps.parseTextBook(content)),
		composePage: (panelImages: Buffer[], pageSpec: unknown, panelSpecs: unknown[], size: unknown) => Effect.tryPromise(() => deps.composePage(panelImages, pageSpec, panelSpecs, size)),
		exportMotionComic: (timeline: unknown, pageImages: Map<string, string>, audioPath: string | undefined, outputPath: string) => Effect.tryPromise(() => deps.exportMotionComic(timeline, pageImages, audioPath, outputPath)),
		exportPageBundle: (pageImages: string[], outputPath: string) => Effect.tryPromise(() => deps.exportPageBundle(pageImages, outputPath)),
	});
}
