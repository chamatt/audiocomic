// Migration runner.
//
// Applies every SQL file listed in migrations/meta/_journal.json against the
// database pointed at by DATABASE_URL. Tracks applied migrations in the
// drizzle migrations table so re-runs are idempotent.
//
// Usage: bun run migrate  (or `tsx src/migrate.ts`)

import { config } from 'dotenv';
// Load .env from monorepo root, overriding any pre-existing shell env vars
config({ path: '../../.env', override: true });

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';

import { createDb } from './client';

async function main(): Promise<void> {
  const migrationsFolder = resolve(import.meta.dirname, '..', 'migrations');
  const { db, end } = createDb();

  try {
    await migrate(db, { migrationsFolder });
    console.log('Migrations applied successfully.');
  } finally {
    await end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
