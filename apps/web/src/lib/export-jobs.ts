// In-memory export job tracker.
// Stores progress for background export jobs so the frontend can poll.

export interface ExportJob {
  id: string;
  chapterId: string;
  status: 'rendering' | 'uploading' | 'done' | 'failed';
  progress: { done: number; total: number };
  result?: {
    mp4Url: string;
    sizeBytes: number;
    durationSec: number;
    slides: number;
  };
  error?: string;
  startedAt: number;
}

// Module-level map — survives across requests within the same server process.
const jobs = new Map<string, ExportJob>();

export function createJob(id: string, chapterId: string): ExportJob {
  const job: ExportJob = {
    id,
    chapterId,
    status: 'rendering',
    progress: { done: 0, total: 0 },
    startedAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): ExportJob | undefined {
  return jobs.get(id);
}

export function updateJobProgress(id: string, done: number, total: number): void {
  const job = jobs.get(id);
  if (job) {
    job.progress = { done, total };
  }
}

export function completeJob(id: string, result: ExportJob['result']): void {
  const job = jobs.get(id);
  if (job) {
    job.status = 'done';
    job.result = result;
  }
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (job) {
    job.status = 'failed';
    job.error = error;
  }
}

export function setJobStatus(id: string, status: ExportJob['status']): void {
  const job = jobs.get(id);
  if (job) {
    job.status = status;
  }
}

// Clean up old completed jobs (older than 10 minutes).
export function cleanupJobs(): void {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, job] of jobs) {
    if ((job.status === 'done' || job.status === 'failed') && job.startedAt < cutoff) {
      jobs.delete(id);
    }
  }
}
