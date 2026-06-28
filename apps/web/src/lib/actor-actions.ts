'use server';

import { Effect } from "effect";
import { runWithClient, fileRegistryClient, bibleClient, projectClient, pipelineClient } from "@/lib/rivet-client";
import type {
  ProjectConfig,
  BibleContent,
  FileMetadata,
  StepState,
  PipelineState,
  PipelineStatus,
  CronSchedule,
} from "@audiocomic/actors";

export type ActorResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(program: Effect.Effect<T, unknown, unknown>): Promise<ActorResult<T>> {
  try {
    const data = await runWithClient(program);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================================
// Project actor
// ============================================================================

export async function createProjectActor(name: string, description: string): Promise<ActorResult<{ key: string; config: ProjectConfig }>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* projectClient;
      const handle = accessor.getOrCreate("main");
      yield* handle.UpdateName({ name });
      yield* handle.UpdateDescription({ description });
      const config = yield* handle.GetConfig(undefined);
      return { key: "main", config };
    }),
  );
}

export async function getProjectConfigActor(key: string): Promise<ActorResult<ProjectConfig>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* projectClient;
      const handle = accessor.getOrCreate(key);
      return yield* handle.GetConfig(undefined);
    }),
  );
}

export async function linkBibleActor(projectKey: string, bibleId: string): Promise<ActorResult<ProjectConfig>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* projectClient;
      const handle = accessor.getOrCreate(projectKey);
      return yield* handle.SetBible({ bibleId });
    }),
  );
}

export async function addPipelineToProjectActor(projectKey: string, pipelineId: string): Promise<ActorResult<ProjectConfig>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* projectClient;
      const handle = accessor.getOrCreate(projectKey);
      return yield* handle.AddPipeline({ pipelineId });
    }),
  );
}

// ============================================================================
// FileRegistry actor
// ============================================================================

export async function registerFileActor(
  originalName: string,
  sourcePath: string,
  tags: string[],
  projectId?: string,
): Promise<ActorResult<FileMetadata>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* fileRegistryClient;
      const handle = accessor.getOrCreate("main");
      return yield* handle.RegisterPath({ originalName, sourcePath, tags, projectId });
    }),
  );
}

export async function listFilesActor(tag?: string, projectId?: string): Promise<ActorResult<readonly FileMetadata[]>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* fileRegistryClient;
      const handle = accessor.getOrCreate("main");
      return yield* handle.ListFiles({ tag, projectId });
    }),
  );
}

// ============================================================================
// Bible actor
// ============================================================================

export async function createBibleActor(title: string, lore: string): Promise<ActorResult<{ key: string; content: BibleContent }>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* bibleClient;
      const handle = accessor.getOrCreate("main");
      yield* handle.UpdateLore({ lore });
      const content = yield* handle.GetContent(undefined);
      return { key: "main", content };
    }),
  );
}

export async function getBibleContentActor(key: string): Promise<ActorResult<BibleContent>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* bibleClient;
      const handle = accessor.getOrCreate(key);
      return yield* handle.GetContent(undefined);
    }),
  );
}

export async function addCharacterActor(bibleKey: string, name: string, description: string): Promise<ActorResult<BibleContent>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* bibleClient;
      const handle = accessor.getOrCreate(bibleKey);
      return yield* handle.AddCharacter({ name, description });
    }),
  );
}

// ============================================================================
// Pipeline actor — step management
// ============================================================================

export type AddStepInput = {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  dependsOn: string[];
};

export async function addPipelineStepActor(pipelineKey: string, step: AddStepInput): Promise<ActorResult<readonly StepState[]>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* pipelineClient;
      const handle = accessor.getOrCreate(pipelineKey);
      return yield* handle.AddStep({ step });
    }),
  );
}

export async function removePipelineStepActor(pipelineKey: string, stepId: string): Promise<ActorResult<readonly StepState[]>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* pipelineClient;
      const handle = accessor.getOrCreate(pipelineKey);
      return yield* handle.RemoveStep({ stepId });
    }),
  );
}

// ============================================================================
// Pipeline actor — lifecycle
// ============================================================================

export async function startPipelineActor(pipelineKey: string): Promise<ActorResult<PipelineStatus>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* pipelineClient;
      const handle = accessor.getOrCreate(pipelineKey);
      return yield* handle.Start(undefined);
    }),
  );
}

export async function pausePipelineActor(pipelineKey: string): Promise<ActorResult<PipelineStatus>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* pipelineClient;
      const handle = accessor.getOrCreate(pipelineKey);
      return yield* handle.Pause(undefined);
    }),
  );
}

export async function resumePipelineActor(pipelineKey: string): Promise<ActorResult<PipelineStatus>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* pipelineClient;
      const handle = accessor.getOrCreate(pipelineKey);
      return yield* handle.Resume(undefined);
    }),
  );
}

export async function retryStepActor(pipelineKey: string, stepId: string): Promise<ActorResult<StepState>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* pipelineClient;
      const handle = accessor.getOrCreate(pipelineKey);
      return yield* handle.RetryStep({ stepId });
    }),
  );
}

export async function skipStepActor(pipelineKey: string, stepId: string): Promise<ActorResult<StepState>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* pipelineClient;
      const handle = accessor.getOrCreate(pipelineKey);
      return yield* handle.SkipStep({ stepId });
    }),
  );
}

// ============================================================================
// Pipeline actor — status + cron
// ============================================================================

export async function getPipelineStatusActor(pipelineKey: string): Promise<ActorResult<PipelineState>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* pipelineClient;
      const handle = accessor.getOrCreate(pipelineKey);
      return yield* handle.GetStatus(undefined);
    }),
  );
}

export async function schedulePipelineActor(pipelineKey: string, intervalMs: number): Promise<ActorResult<CronSchedule>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* pipelineClient;
      const handle = accessor.getOrCreate(pipelineKey);
      return yield* handle.Schedule({ intervalMs });
    }),
  );
}

export async function cancelScheduleActor(pipelineKey: string): Promise<ActorResult<boolean>> {
  return run(
    Effect.gen(function* () {
      const accessor = yield* pipelineClient;
      const handle = accessor.getOrCreate(pipelineKey);
      return yield* handle.CancelSchedule(undefined);
    }),
  );
}

// ============================================================================
// Pipeline actor — single-step operations
// ============================================================================

export async function runStepActor(pipelineKey: string, stepId: string): Promise<ActorResult<StepState>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.RunStep({ stepId });
		}),
	);
}

export async function getStepResultActor(pipelineKey: string, stepId: string): Promise<ActorResult<unknown>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.GetStepResult({ stepId });
		}),
	);
}

export async function getStepLogsActor(pipelineKey: string, stepId: string): Promise<ActorResult<readonly unknown[]>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.GetStepLogs({ stepId });
		}),
	);
}

export async function invalidateStepActor(pipelineKey: string, stepId: string): Promise<ActorResult<readonly StepState[]>> {
	return run(
		Effect.gen(function* () {
			const accessor = yield* pipelineClient;
			const handle = accessor.getOrCreate(pipelineKey);
			return yield* handle.InvalidateStep({ stepId });
		}),
	);
}
