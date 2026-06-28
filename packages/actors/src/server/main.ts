import { NodeRuntime } from "@effect/platform-node";
import { Client, Registry } from "@rivetkit/effect";
import { Effect, Layer } from "effect";
import { FileRegistryLive } from "../actors/file-registry/live.ts";
import { BibleLive } from "../actors/bible/live.ts";
import { ProjectLive } from "../actors/project/live.ts";
import { PipelineLive } from "../actors/pipeline/live.ts";
// Import step executors to register them
import "../actors/pipeline/steps/index.ts";
import { StorageLive, FFmpegLive } from "../lib/services.ts";
import { PipelineBridgeLive } from "../lib/pipeline-bridge.ts";

const endpoint = process.env.RIVET_ENDPOINT ?? "http://127.0.0.1:6420";

const ActorsLayer = Layer.mergeAll(
	FileRegistryLive,
	BibleLive,
	ProjectLive,
	PipelineLive,
).pipe(
	Layer.provide(StorageLive),
	Layer.provide(FFmpegLive),
	Layer.provide(PipelineBridgeLive),
	Layer.provide(Client.layer({ endpoint })),
);

const MainLayer = Registry.serve(ActorsLayer).pipe(Layer.provide(Registry.layer()));

Effect.gen(function* () {
	yield* Effect.log("Starting AudioComic actor server...");
	yield* Effect.log(`Endpoint: ${endpoint}`);
	yield* Effect.log("Actors: FileRegistry, Bible, Project, Pipeline");
	yield* Effect.log("Steps: 15 registered (normalize → export_motion)");
}).pipe(
	Effect.flatMap(() => Layer.launch(MainLayer)),
	NodeRuntime.runMain,
);
