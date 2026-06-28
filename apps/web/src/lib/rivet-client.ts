import { Client } from "@rivetkit/effect";
import { Effect, Layer } from "effect";

import { FileRegistry } from "@audiocomic/actors/src/actors/file-registry/api.ts";
import { Bible } from "@audiocomic/actors/src/actors/bible/api.ts";
import { Project } from "@audiocomic/actors/src/actors/project/api.ts";
import { Pipeline } from "@audiocomic/actors/src/actors/pipeline/api.ts";

/**
 * Endpoint of the Rivet actor server. The actors package's
 * `packages/actors/src/server/main.ts` listens here by default.
 */
const endpoint = process.env.RIVET_ENDPOINT ?? "http://127.0.0.1:6420";

/**
 * A `Layer` providing the {@link Client.Client} service over the Rivet
 * transport. Provide it once at the root of an Effect program; every
 * `yield* SomeActor.client` then dispatches through the same transport.
 */
export const RivetClientLayer: Layer.Layer<Client.Client> = Client.layer({
	endpoint,
});

/**
 * Run an Effect program with the Rivet client layer provided.
 *
 * Use this from server actions to execute actor calls and receive a
 * plain Promise. Errors propagate as rejections so callers can
 * `try/catch` (or `.catch`) and return serializable results.
 */
export function runWithClient<A, E, R>(
	program: Effect.Effect<A, E, R>,
): Promise<A> {
	return Effect.runPromise(
		program.pipe(Effect.provide(RivetClientLayer)),
	);
}

// ---------------------------------------------------------------------------
// Typed actor accessors
//
// Each `Actor.client` is an `Effect<Accessor<Actions>, never, Client.Client>`.
// Yield it inside an `Effect.gen` (run via `runWithClient`) to get a handle
// factory, then call `getOrCreate(key)` to address one actor instance.
// ---------------------------------------------------------------------------

export const fileRegistryClient = FileRegistry.client;
export const bibleClient = Bible.client;
export const projectClient = Project.client;
export const pipelineClient = Pipeline.client;
