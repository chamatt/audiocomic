import { getEnv } from '@audiocomic/shared';
import type { JobRecord, ProjectStage, StageState } from '@audiocomic/domain';
import { uuid, nowIso } from '@audiocomic/shared';
import { JobWorker, type WorkerDeps } from './engine.js';
import {
  FullPipelineHandler,
  RegeneratePanelHandler,
  RegeneratePageHandler,
  ExportHandler,
  type PipelineDeps,
} from './pipeline.js';
import { createPipelineDeps } from './deps.js';

// ============================================================================
// Worker entry point — polls the jobs table and executes pending jobs
// ============================================================================

export async function startWorker(): Promise<void> {
  const env = getEnv();
  console.log(`[worker] starting with concurrency=${env.WORKER_CONCURRENCY}`);

  const pipelineDeps = await createPipelineDeps();
  const workerDeps = createWorkerDeps(pipelineDeps);
  const worker = new JobWorker(workerDeps, {
    concurrency: parseInt(env.WORKER_CONCURRENCY, 10),
    pollIntervalMs: 2000,
    maxAttempts: 3,
  });

  worker.register(new FullPipelineHandler(pipelineDeps));
  worker.register(new RegeneratePanelHandler(pipelineDeps));
  worker.register(new RegeneratePageHandler(pipelineDeps));
  worker.register(new ExportHandler(pipelineDeps));

  console.log('[worker] registered handlers: full_pipeline, regenerate_panel, regenerate_page, export');

  // Graceful shutdown
  const shutdown = () => {
    console.log('[worker] shutting down...');
    worker.stop();
    setTimeout(() => process.exit(0), 1000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await worker.start();
}

function createWorkerDeps(pipelineDeps: PipelineDeps): WorkerDeps {
  return {
    async claimNextJob(): Promise<JobRecord | null> {
      // Use the repo to claim a pending job atomically
      // The repo implementation should use SELECT ... FOR UPDATE SKIP LOCKED
      return pipelineDeps.repo.claimNextJob();
    },
    async markJobRunning(jobId: string): Promise<void> {
      await pipelineDeps.repo.updateJob(jobId, {
        state: 'running',
        startedAt: nowIso(),
      });
    },
    async completeJob(jobId: string, result?: Record<string, unknown>): Promise<void> {
      await pipelineDeps.repo.updateJob(jobId, {
        state: 'completed',
        progress: 1,
        completedAt: nowIso(),
        result,
      });
    },
    async failJob(jobId: string, error: string): Promise<void> {
      await pipelineDeps.repo.updateJob(jobId, {
        state: 'failed',
        error,
        completedAt: nowIso(),
      });
    },
    async retryJob(jobId: string, attempts: number, error: string): Promise<void> {
      await pipelineDeps.repo.updateJob(jobId, {
        state: 'pending',
        attempts,
        error,
      });
    },
    async updateJobProgress(jobId: string, progress: number): Promise<void> {
      await pipelineDeps.repo.updateJob(jobId, { progress });
    },
    async updateProjectStage(
      projectId: string,
      stage: ProjectStage,
      state: StageState,
      error?: string,
    ): Promise<void> {
      await pipelineDeps.repo.updateProjectStage(projectId, stage, state, error);
    },
    async log(message: string): Promise<void> {
      console.log(`[worker] ${message}`);
    },
  };
}

// Entry point when run directly
startWorker().catch((err) => {
  console.error('[worker] fatal error:', err);
  process.exit(1);
});
