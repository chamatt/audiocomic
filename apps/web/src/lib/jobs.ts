import type { JobRecord } from '@audiocomic/domain';
import { repo } from './db';

// The job queue is backed by the jobs table in Postgres.
// The worker (in @audiocomic/workflows) polls this table and executes jobs.
// For MVP, this is a simple polling-based queue. For production, this would
// use Temporal or a proper queue (LISTEN/NOTIFY, SKIP LOCKED, etc).

export async function enqueueJob(job: JobRecord): Promise<void> {
  await repo.jobs.create(job);
}

export async function getPendingJobs(limit = 10): Promise<JobRecord[]> {
  // The repo could expose a getPending method; for now we use the raw query
  // through the jobs table. The worker package handles the actual polling.
  // This is a thin client-side helper for the web app.
  const env = (await import('@audiocomic/shared')).getEnv();
  const { getDb } = await import('./db');
  const db = await getDb();
  if (!db) return [];
  // The worker has its own polling; the web app just enqueues.
  return [];
}
