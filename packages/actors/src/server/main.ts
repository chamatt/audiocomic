import { NodeRuntime } from "@effect/platform-node";
import { Client, Registry } from "@rivetkit/effect";
import { Layer } from "effect";
import { FileRegistryLive } from "../actors/file-registry/live.ts";
import { BibleLive } from "../actors/bible/live.ts";
import { ProjectLive } from "../actors/project/live.ts";
import { PipelineLive } from "../actors/pipeline/live.ts";
// Import step executors to register them
import "../actors/pipeline/steps/index.ts";
import { StorageLive, FFmpegLive } from "../lib/services.ts";

const endpoint = process.env.RIVET_ENDPOINT ?? "http://127.0.0.1:6420";

const ActorsLayer = Layer.mergeAll(
	FileRegistryLive,
	BibleLive,
	ProjectLive,
	PipelineLive,
).pipe(
	Layer.provide(StorageLive),
	Layer.provide(FFmpegLive),
	Layer.provide(Client.layer({ endpoint })),
);

const MainLayer = Registry.serve(ActorsLayer).pipe(Layer.provide(Registry.layer()));

Layer.launch(MainLayer).pipe(NodeRuntime.runMain);
