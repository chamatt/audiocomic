import { Client } from "@rivetkit/effect";
import { Effect } from "effect";
import { FileRegistry } from "@audiocomic/actors/src/actors/file-registry/api.ts";
import { Bible } from "@audiocomic/actors/src/actors/bible/api.ts";
import { Project } from "@audiocomic/actors/src/actors/project/api.ts";
import { Pipeline } from "@audiocomic/actors/src/actors/pipeline/api.ts";
import { Chapter } from "@audiocomic/actors/src/actors/chapter/api.ts";
import { KnowledgeBase } from "@audiocomic/actors/src/actors/knowledge-base/api.ts";

const endpoint = process.env.RIVET_ENDPOINT ?? "http://127.0.0.1:6420";

const RivetClientLayer = Client.layer({ endpoint });

export function runWithClient<A, E, R>(program: Effect.Effect<A, E, R>): Promise<A> {
  return Effect.runPromise(
    program.pipe(Effect.provide(RivetClientLayer)) as Effect.Effect<A, E, never>,
  );
}

export const fileRegistryClient = FileRegistry.client;
export const bibleClient = Bible.client;
export const projectClient = Project.client;
export const pipelineClient = Pipeline.client;
export const chapterClient = Chapter.client;
export const knowledgeBaseClient = KnowledgeBase.client;
