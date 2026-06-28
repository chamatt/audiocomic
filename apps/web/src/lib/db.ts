// Clean database access — uses @audiocomic/db Repository directly.
// No manual snakeToCamel, no `as unknown as` casts.

import { config } from 'dotenv';
config({ path: '../../.env', override: true });

import { createDb, createRepository, type Repository, type CreateDbResult } from '@audiocomic/db';

let _instance: CreateDbResult | null = null;
let _repo: Repository | null = null;
let _init: Promise<Repository> | null = null;

async function ensureRepo(): Promise<Repository> {
  if (_repo) return _repo;
  if (_init) return _init;

  _init = (async () => {
    _instance = createDb();
    _repo = createRepository(_instance.db);
    return _repo;
  })();

  try {
    return await _init;
  } catch (err) {
    _init = null;
    throw err;
  }
}

export async function getRepo(): Promise<Repository> {
  return ensureRepo();
}

export async function getSql() {
  if (!_instance) await ensureRepo();
  return _instance?.sql ?? null;
}

// Initialize eagerly on server boot
if (typeof window === 'undefined') {
  ensureRepo().catch((err) => {
    console.error('[db] Failed to initialize:', err);
  });
}
