import { Effect } from "effect";
import { State } from "@rivetkit/effect";

import { Project } from "./api.ts";
import {
	ProjectConfig as ProjectConfigSchema,
	type ProjectConfig,
} from "../../lib/schemas.ts";

/**
 * Fresh, empty project configuration. The actor is keyed, so the
 * durable `id` is derived from the actor key by the caller; the
 * initial state only needs to be a valid placeholder with no
 * pipelines attached.
 */
function freshConfig(): ProjectConfig {
	const now = Date.now();
	return {
		id: "",
		name: "",
		description: "",
		bibleId: undefined,
		pipelineIds: [],
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * Live server implementation of the Project actor.
 *
 * State is the full `ProjectConfig` schema. Every mutation applies an
 * atomic `State.updateAndGet`, bumps `updatedAt`, and broadcasts a
 * `projectUpdated` event carrying the new config so subscribed clients
 * can reconcile. `Effect.orDie` collapses the state schema-error
 * channel so action handlers satisfy the `E = never` contract required
 * by `Project.of`.
 */
export const ProjectLive = Project.toLayer(
	(wakeOptions) =>
		Project.of({
			GetConfig: () =>
				Effect.gen(function* () {
					return yield* State.get(wakeOptions.state).pipe(
						Effect.orDie,
					);
				}),

			UpdateName: ({ payload }) =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(
						wakeOptions.state,
						(config): ProjectConfig => ({
							...config,
							name: payload.name,
							updatedAt: Date.now(),
						}),
					).pipe(Effect.orDie);

					wakeOptions.rawRivetkitContext.broadcast(
						"projectUpdated",
						updated,
					);
					return updated;
				}),

			UpdateDescription: ({ payload }) =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(
						wakeOptions.state,
						(config): ProjectConfig => ({
							...config,
							description: payload.description,
							updatedAt: Date.now(),
						}),
					).pipe(Effect.orDie);

					wakeOptions.rawRivetkitContext.broadcast(
						"projectUpdated",
						updated,
					);
					return updated;
				}),

			SetBible: ({ payload }) =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(
						wakeOptions.state,
						(config): ProjectConfig => ({
							...config,
							bibleId: payload.bibleId,
							updatedAt: Date.now(),
						}),
					).pipe(Effect.orDie);

					wakeOptions.rawRivetkitContext.broadcast(
						"projectUpdated",
						updated,
					);
					return updated;
				}),

			AddPipeline: ({ payload }) =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(
						wakeOptions.state,
						(config): ProjectConfig => ({
							...config,
							pipelineIds: config.pipelineIds.includes(
								payload.pipelineId,
							)
								? config.pipelineIds
								: [...config.pipelineIds, payload.pipelineId],
							updatedAt: Date.now(),
						}),
					).pipe(Effect.orDie);

					wakeOptions.rawRivetkitContext.broadcast(
						"projectUpdated",
						updated,
					);
					return updated;
				}),

			RemovePipeline: ({ payload }) =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(
						wakeOptions.state,
						(config): ProjectConfig => ({
							...config,
							pipelineIds: config.pipelineIds.filter(
								(id) => id !== payload.pipelineId,
							),
							updatedAt: Date.now(),
						}),
					).pipe(Effect.orDie);

					wakeOptions.rawRivetkitContext.broadcast(
						"projectUpdated",
						updated,
					);
					return updated;
				}),
		}),
	{
		state: {
			schema: ProjectConfigSchema,
			initialValue: freshConfig,
		},
	},
);
