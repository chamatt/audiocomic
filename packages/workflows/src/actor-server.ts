// Actor server entry point — starts the Rivet actor server with real pipeline adapters.
// This replaces the polling-based worker with actor-driven pipeline orchestration.
//
// Usage: bun run actor-server (or) RIVET_RUN_ENGINE=1 npx tsx src/actor-server.ts

import { config } from 'dotenv';
config({ path: '../../.env', override: true });

import { NodeRuntime } from '@effect/platform-node';
import { Client, Registry } from '@rivetkit/effect';
import { Effect, Layer } from 'effect';
import { FileRegistryLive } from '@audiocomic/actors/src/actors/file-registry/live.ts';
import { BibleLive } from '@audiocomic/actors/src/actors/bible/live.ts';
import { ProjectLive } from '@audiocomic/actors/src/actors/project/live.ts';
import { PipelineLive } from '@audiocomic/actors/src/actors/pipeline/live.ts';
import '@audiocomic/actors/src/actors/pipeline/steps/index.ts';
import { StorageLive, FFmpegLive } from '@audiocomic/actors/src/lib/services.ts';
import { makePipelineBridgeLayer } from '@audiocomic/actors/src/lib/pipeline-bridge.ts';
import { createPipelineDeps } from './deps.ts';

const endpoint = process.env.RIVET_ENDPOINT ?? 'http://127.0.0.1:6420';

async function main() {
  // Initialize the existing pipeline deps (AI adapters, media, renderers)
  const pipelineDeps = await createPipelineDeps();

  // Create a real pipeline bridge layer from the existing deps
  const bridgeLayer = makePipelineBridgeLayer({
    transcribe: (audioPath) => pipelineDeps.transcribe(audioPath),
    planStory: (input) => pipelineDeps.planStory(input as any),
    composePrompt: (input) => pipelineDeps.composePrompt(input as any),
    renderPanel: (req) => pipelineDeps.renderPanel(req as any),
    probeAudio: (path) => pipelineDeps.probeAudio(path),
    parseTextBook: (content) => pipelineDeps.parseTextBook(content),
    composePage: (panelImages, pageSpec, panelSpecs, size) =>
      pipelineDeps.composePage(panelImages, pageSpec as any, panelSpecs as any, size as any),
    exportMotionComic: (timeline, pageImages, audioPath, outputPath) =>
      pipelineDeps.exportMotionComic(timeline as any, pageImages, audioPath, outputPath),
    exportPageBundle: (pageImages, outputPath) =>
      pipelineDeps.exportPageBundle(pageImages, outputPath),
  });

  const ActorsLayer = Layer.mergeAll(
    FileRegistryLive,
    BibleLive,
    ProjectLive,
    PipelineLive,
  ).pipe(
    Layer.provide(StorageLive),
    Layer.provide(FFmpegLive),
    Layer.provide(bridgeLayer),
    Layer.provide(Client.layer({ endpoint })),
  );

  const MainLayer = Registry.serve(ActorsLayer).pipe(Layer.provide(Registry.layer()));

  Effect.gen(function* () {
    yield* Effect.log('Starting AudioComic actor server with real pipeline adapters...');
    yield* Effect.log(`Endpoint: ${endpoint}`);
    yield* Effect.log('Actors: FileRegistry, Bible, Project, Pipeline');
    yield* Effect.log('Pipeline bridge: connected to @audiocomic/ai, @audiocomic/renderers, @audiocomic/media');
  }).pipe(
    Effect.flatMap(() => Layer.launch(MainLayer)),
    NodeRuntime.runMain,
  );
}

main().catch((err) => {
  console.error('[actor-server] Failed to start:', err);
  process.exit(1);
});
