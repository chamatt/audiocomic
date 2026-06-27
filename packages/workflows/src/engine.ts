import type { JobRecord, Project, ProjectStage, StageState } from '@audiocomic/domain';
import { uuid, nowIso } from '@audiocomic/shared';
import { STAGE_ORDER, computeProgress, nextStage } from './stages';

// ============================================================================
// Durable job engine — polling-based worker with retry and crash recovery
// ============================================================================

export interface JobHandler {
  readonly jobType: JobRecord['type'];
  execute(job: JobRecord, context: JobContext): Promise<JobResult>;
}

export interface JobResult {
  success: boolean;
  error?: string;
  result?: Record<string, unknown>;
  // Stages that were completed during this job
  completedStages?: ProjectStage[];
}

export interface JobContext {
  projectId: string;
  updateProgress: (progress: number) => Promise<void>;
  updateStage: (stage: ProjectStage, state: StageState, error?: string) => Promise<void>;
  log: (message: string) => void;
}

export interface WorkerOptions {
  pollIntervalMs?: number;
  maxAttempts?: number;
  concurrency?: number;
}

export class JobWorker {
  private handlers = new Map<JobRecord['type'], JobHandler>();
  private running = false;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly concurrency: number;

  constructor(
    private readonly deps: WorkerDeps,
    options: WorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.concurrency = options.concurrency ?? 4;
  }

  register(handler: JobHandler): void {
    this.handlers.set(handler.jobType, handler);
  }

  async start(): Promise<void> {
    this.running = true;
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < this.concurrency; i++) {
      tasks.push(this.runLoop());
    }
    await Promise.all(tasks);
  }

  stop(): void {
    this.running = false;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const job = await this.deps.claimNextJob();
        if (!job) {
          await sleep(this.pollIntervalMs);
          continue;
        }
        await this.processJob(job);
      } catch (err) {
        await this.deps.log(`Worker loop error: ${err instanceof Error ? err.message : String(err)}`);
        await sleep(this.pollIntervalMs);
      }
    }
  }

  private async processJob(job: JobRecord): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.deps.failJob(job.id, `No handler for job type: ${job.type}`);
      return;
    }

    const context: JobContext = {
      projectId: job.projectId,
      updateProgress: (progress) => this.deps.updateJobProgress(job.id, progress),
      updateStage: (stage, state, error) =>
        this.deps.updateProjectStage(job.projectId, stage, state, error),
      log: (msg) => this.deps.log(`[job ${job.id}] ${msg}`),
    };

    try {
      await this.deps.markJobRunning(job.id);
      const result = await handler.execute(job, context);

      if (result.success) {
        await this.deps.completeJob(job.id, result.result);
        if (result.completedStages) {
          for (const stage of result.completedStages) {
            await this.deps.updateProjectStage(job.projectId, stage, 'completed');
          }
        }
      } else {
        await this.handleFailure(job, result.error ?? 'Unknown error');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.handleFailure(job, message);
    }
  }

  private async handleFailure(job: JobRecord, error: string): Promise<void> {
    const attempts = job.attempts + 1;
    if (attempts >= this.maxAttempts) {
      await this.deps.failJob(job.id, error);
    } else {
      await this.deps.retryJob(job.id, attempts, error);
    }
  }
}

export interface WorkerDeps {
  claimNextJob(): Promise<JobRecord | null>;
  markJobRunning(jobId: string): Promise<void>;
  completeJob(jobId: string, result?: Record<string, unknown>): Promise<void>;
  failJob(jobId: string, error: string): Promise<void>;
  retryJob(jobId: string, attempts: number, error: string): Promise<void>;
  updateJobProgress(jobId: string, progress: number): Promise<void>;
  updateProjectStage(projectId: string, stage: ProjectStage, state: StageState, error?: string): Promise<void>;
  log(message: string): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
