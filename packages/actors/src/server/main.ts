import { NodeRuntime } from "@effect/platform-node";
import { Client, Registry } from "@rivetkit/effect";
import { Effect, Layer } from "effect";
import { config } from "dotenv";
config({ path: "../../.env", override: true });

import { FileRegistryLive } from "../actors/file-registry/live.ts";
import { BibleLive } from "../actors/bible/live.ts";
import { ProjectLive } from "../actors/project/live.ts";
import { PipelineLive } from "../actors/pipeline/live.ts";
import { ChapterLive } from "../actors/chapter/live.ts";
import { KnowledgeBaseLive } from "../actors/knowledge-base/live.ts";
// Import step executors to trigger registration with the step registry
import { FFmpegLive } from "../lib/services.ts";
import { makePipelineBridgeLayer } from "../lib/pipeline-bridge.ts";
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
	ChapterLive,
	KnowledgeBaseLive,
).pipe(
	Layer.provide(FFmpegLive),
	Layer.provide(bridgeLayer),
	Layer.provide(Client.layer({ endpoint })),
);

// Enable local SQLite persistence so actor state survives restarts.
// The `sqlite` option is spread into Rivetkit.setup() by Registry.layer,
// even though the TS type doesn't expose it.
const MainLayer = Registry.serve(ActorsLayer).pipe(
	Layer.provide(Registry.layer({
		...({ sqlite: "local" } as unknown as Record<string, unknown>),
	})),
);

Effect.gen(function* () {
	yield* Effect.log("Starting AudioComic actor server...");
	yield* Effect.log(`Endpoint: ${endpoint}`);
	yield* Effect.log("Actors: FileRegistry, Bible, Project, Pipeline, Chapter, KnowledgeBase");
	yield* Effect.log("Steps: 14 registered (ingest_knowledge → export_motion)");
	yield* Effect.log("Bridge: direct adapters (@audiocomic/ai, @audiocomic/renderers, @audiocomic/media)");
}).pipe(
	Effect.flatMap(() => Layer.launch(MainLayer)),
	NodeRuntime.runMain,
);
