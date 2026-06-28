import { Effect } from "effect";
import { State } from "@rivetkit/effect";

import { Project } from "./api.ts";
import {
	ProjectConfig as ProjectConfigSchema,
	type ProjectConfig,
	type ChapterSummary,
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
		chapterIds: [],
		chapterSummaries: [],
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
						(config: ProjectConfig): ProjectConfig => ({
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
						(config: ProjectConfig): ProjectConfig => ({
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
						(config: ProjectConfig): ProjectConfig => ({
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
						(config: ProjectConfig): ProjectConfig => ({
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
						(config: ProjectConfig): ProjectConfig => ({
							...config,
							pipelineIds: config.pipelineIds.filter(
								(id: string) => id !== payload.pipelineId,
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

			AddChapter: ({ payload }) =>
				Effect.gen(function* () {
					const summary: ChapterSummary = {
						id: payload.chapterId,
						title: payload.title,
						index: payload.index,
						status: "pending",
						transcriptionStatus: "pending",
					};
					const updated = yield* State.updateAndGet(
						wakeOptions.state,
						(config: ProjectConfig): ProjectConfig => {
							if ((config.chapterIds ?? []).includes(payload.chapterId)) {
								return { ...config, updatedAt: Date.now() };
							}
							return {
								...config,
								chapterIds: [...(config.chapterIds ?? []), payload.chapterId],
								chapterSummaries: [...(config.chapterSummaries ?? []), summary],
								updatedAt: Date.now(),
							};
						},
					).pipe(Effect.orDie);

					wakeOptions.rawRivetkitContext.broadcast(
						"projectUpdated",
						updated,
					);
					return updated;
				}),

			RemoveChapter: ({ payload }) =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(
						wakeOptions.state,
						(config: ProjectConfig): ProjectConfig => ({
							...config,
							chapterIds: (config.chapterIds ?? []).filter(
								(id: string) => id !== payload.chapterId,
							),
							chapterSummaries: (config.chapterSummaries ?? []).filter(
								(s: ChapterSummary) => s.id !== payload.chapterId,
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

			ListChapters: () =>
				Effect.gen(function* () {
					const config = yield* State.get(wakeOptions.state).pipe(
						Effect.orDie,
					);
					return config.chapterSummaries ?? [];
				}),

			ReorderChapters: ({ payload }) =>
				Effect.gen(function* () {
					const updated = yield* State.updateAndGet(
						wakeOptions.state,
						(config: ProjectConfig): ProjectConfig => {
							const reorderedSummaries: ChapterSummary[] = payload.chapterIds
								.map((id: string, index: number) => {
									const existing = (config.chapterSummaries ?? []).find(
										(s: ChapterSummary) => s.id === id,
									);
									return existing
										? { ...existing, index }
										: null;
								})
								.filter((s: ChapterSummary | null): s is ChapterSummary => s !== null);
							return {
								...config,
								chapterIds: payload.chapterIds,
								chapterSummaries: reorderedSummaries,
								updatedAt: Date.now(),
							};
						},
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
