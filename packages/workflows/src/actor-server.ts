// Actor server entry point — starts the Rivet actor server with real pipeline adapters.
// This replaces the polling-based worker with actor-driven pipeline orchestration.
//
// Usage: bun run actor-server

import { config } from "dotenv";
config({ path: "../../.env", override: true });

import { NodeRuntime } from "@effect/platform-node";
import { Client, Registry } from "@rivetkit/effect";
import { Effect, Layer } from "effect";
import { FileRegistryLive } from "@audiocomic/actors/src/actors/file-registry/live.ts";
import { BibleLive } from "@audiocomic/actors/src/actors/bible/live.ts";
import { ProjectLive } from "@audiocomic/actors/src/actors/project/live.ts";
import { PipelineLive } from "@audiocomic/actors/src/actors/pipeline/live.ts";
import "@audiocomic/actors/src/actors/pipeline/steps/index.ts";
import { StorageLive, FFmpegLive } from "@audiocomic/actors/src/lib/services.ts";
import { makePipelineBridgeLayer } from "@audiocomic/actors/src/lib/pipeline-bridge.ts";
import { createDb } from "@audiocomic/db";
import { getEnv } from "@audiocomic/shared";

const endpoint = process.env.RIVET_ENDPOINT ?? "http://127.0.0.1:6420";

const env = getEnv();
const dbResult = createDb(env.DATABASE_URL);
const bridgeLayer = makePipelineBridgeLayer(dbResult, env);

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
	yield* Effect.log("Starting AudioComic actor server with real pipeline adapters...");
	yield* Effect.log(`Endpoint: ${endpoint}`);
	yield* Effect.log("Actors: FileRegistry, Bible, Project, Pipeline");
	yield* Effect.log("Bridge: direct adapters (@audiocomic/ai, @audiocomic/renderers, @audiocomic/media)");
}).pipe(
	Effect.flatMap(() => Layer.launch(MainLayer)),
	NodeRuntime.runMain,
);
