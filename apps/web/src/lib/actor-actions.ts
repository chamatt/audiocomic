"use server";

import { Effect } from "effect";

import { uuid } from "@audiocomic/shared";
import {
	runWithClient,
	projectClient,
	fileRegistryClient,
	bibleClient,
	pipelineClient,
} from "@/lib/rivet-client";
import type {
	ProjectConfig,
	BibleContent,
	FileMetadata,
	StepState,
	PipelineState,
	PipelineStatus,
	CronSchedule,
	StepDefinition,
} from "@audiocomic/actors";

// ---------------------------------------------------------------------------
// Result shape
//
// Server actions must return plain serializable values. Every action
// normalizes its outcome into a discriminated `ActorActionResult` so the
// client can branch on `ok` without try/catch and always has a string
// error to surface.
// ---------------------------------------------------------------------------

export type ActorActionResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: string };

/**
 * Run an Effect program against the Rivet actor cluster and normalize
 * the outcome into an {@link ActorActionResult}. Any transport, schema,
 * or actor error is captured into `error` instead of throwing.
 */
async function run<T>(
	program: Effect.Effect<T, unknown, unknown>,
): Promise<ActorActionResult<T>> {
	try {
		const data = await runWithClient(program);
		return { ok: true, data };
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: typeof error === "string"
					? error
					: JSON.stringify(error);
		return { ok: false, error: message };
	}
}

// ---------------------------------------------------------------------------
// Project actor
// ---------------------------------------------------------------------------

export interface CreatedProject {
	/** Actor key — the durable identity of the Project actor instance. */
	key: string;
	config: ProjectConfig;
}

/**
 * Create (or address) a Project actor and set its name + description.
 * A fresh actor key is generated; the returned `key` is how callers
 * address this project on subsequent Project/Pipeline calls.
 */
export async function createProjectActor(
	name: string,
	description: string,
): Promise<ActorActionResult<CreatedProject>> {
	const key = uuid();
	return run(
		Effect.gen(function* () {
			const accessor = yield* projectClient;
			const handle = accessor.getOrCreate(key);
			yield* handle.UpdateName({ name });
			const config = yield* handle.UpdateDescription({ description });
			return { key, config } satisfies CreatedProject;
		}),
	);
}

// ---------------------------------------------------------------------------
// FileRegistry actor
// ---------------------------------------------------------------------------

/**
 * Register an existing on-disk file with the FileRegistry actor. The
 * actor copies the file into centralized storage and records its
 * metadata. `projectId` optionally scopes the file to a project and
 * selects a per-project registry instance.
 */
export async function registerFileActor(
	originalName: string,
	sourcePath: string,
	tags: string[],
	projectId?: string,
): Promise<ActorActionResult<FileMetadata>> {
	const registryKey = projectId ?? "default";
	return run(
		Effect.gen(function* () {
			const accessor = yield* fileRegistryClient;
			const handle = accessor.getOrCreate(registryKey);
			return yield* handle.RegisterPath({
				originalName,
				sourcePath,
				tags,
				projectId,
			});
		}),
	);
}

// ---------------------------------------------------------------------------
// Bible actor
// ---------------------------------------------------------------------------

export interface CreatedBible {
	/** Actor key — the durable identity of the Bible actor instance. */
	key: string;
	content: BibleContent;
}

/**
 * Create (or address) a Bible actor and set its lore text. The Bible
 * actor contract exposes `UpdateLore` but no title mutation, so the
 * `title` argument is accepted for caller bookkeeping and the lore is
 * applied to the actor.
 */
export async function createBibleActor(
	title: string,
	lore: string,
): Promise<ActorActionResult<CreatedBible>> {
	const key = uuid();
	return run(
		Effect.gen(function* () {
			const accessor = yield* bibleClient;
			const handle = accessor.getOrCreate(key);
			const content = yield* handle.UpdateLore({ lore });
			return { key, content } satisfies CreatedBible;
		}),
	);
}

// ---------------------------------------------------------------------------
// Pipeline actor — step management
// ---------------------------------------------------------------------------

export type AddStepInput = {
	id: string;
	name: string;
	type: string;
	config: Record<string, unknown>;
	dependsOn: string[];
};

/**
 * Append a step to a Pipeline actor. Returns the full ordered step
 * list after the append.
 */
export async function addPipelineStepActor(
	pipelineKey: string,
	step: AddStepInput,
): Promise<ActorActionResult<StepState[]>> {
	const stepDef: StepDefinition = {
		id: step.id,
		name: step.name,
		type: step.type,
		config: step.config,
		dependsOn: step.dependsOn,
	};
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.AddStep({ step: stepDef });
		}),
	);
}

// ---------------------------------------------------------------------------
// Pipeline actor — lifecycle
// ---------------------------------------------------------------------------

/** Start a pipeline. Returns the resulting high-level pipeline status. */
export async function startPipelineActor(
	pipelineKey: string,
): Promise<ActorActionResult<PipelineStatus>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.Start(undefined);
		}),
	);
}

/** Pause a running pipeline. Returns the resulting pipeline status. */
export async function pausePipelineActor(
	pipelineKey: string,
): Promise<ActorActionResult<PipelineStatus>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.Pause(undefined);
		}),
	);
}

/** Resume a paused pipeline. Returns the resulting pipeline status. */
export async function resumePipelineActor(
	pipelineKey: string,
): Promise<ActorActionResult<PipelineStatus>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.Resume(undefined);
		}),
	);
}

/** Retry a single step by id. Returns the updated step state. */
export async function retryStepActor(
	pipelineKey: string,
	stepId: string,
): Promise<ActorActionResult<StepState>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.RetryStep({ stepId });
		}),
	);
}

/** Skip a single step by id. Returns the updated step state. */
export async function skipStepActor(
	pipelineKey: string,
	stepId: string,
): Promise<ActorActionResult<StepState>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.SkipStep({ stepId });
		}),
	);
}

// ---------------------------------------------------------------------------
// Pipeline actor — status
// ---------------------------------------------------------------------------

/**
 * Read the full pipeline state: high-level status, ordered step
 * states, and optional cron schedule.
 */
export async function getPipelineStatusActor(
	pipelineKey: string,
): Promise<ActorActionResult<PipelineState>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.GetStatus(undefined);
		}),
	);
}

// ---------------------------------------------------------------------------
// Pipeline actor — cron scheduling
// ---------------------------------------------------------------------------

/** Schedule recurring pipeline runs at `intervalMs` cadence. */
export async function schedulePipelineActor(
	pipelineKey: string,
	intervalMs: number,
): Promise<ActorActionResult<CronSchedule>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.Schedule({ intervalMs });
		}),
	);
}

/** Cancel any active cron schedule on the pipeline. */
export async function cancelScheduleActor(
	pipelineKey: string,
): Promise<ActorActionResult<boolean>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.CancelSchedule(undefined);
		}),
	);
}
