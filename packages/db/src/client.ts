// Database client factory.
//
// Creates a postgres.js connection and wraps it in a Drizzle instance
// configured with snake_case column casing so camelCase TS properties map to
// the snake_case SQL columns defined in the migration.

import postgres from 'postgres';
import type { Options, Sql as PostgresSql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { getEnv } from '@audiocomic/shared';
import * as schema from './schema.js';

export type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/** Drizzle database instance bound to the audiocomic schema. */
export type Db = PostgresJsDatabase<typeof schema>;

/** Underlying postgres.js connection handle. */
export type Sql = PostgresSql;

export interface CreateDbOptions {
  /** Override DATABASE_URL (defaults to getEnv().DATABASE_URL). */
  url?: string;
  postgresOptions?: Options<Record<string, never>>;
}

export interface CreateDbResult {
  db: Db;
  sql: Sql;
  /** Close the underlying postgres.js connection. */
  end: () => Promise<void>;
}

/**
 * Create a Drizzle database instance backed by postgres.js.
 *
 * Reads `DATABASE_URL` from the shared env config when no URL is supplied.
 */
export function createDb(urlOrOptions?: string | CreateDbOptions): CreateDbResult {
  const url =
    typeof urlOrOptions === 'string' ? urlOrOptions : (urlOrOptions?.url ?? getEnv().DATABASE_URL);
  const postgresOptions =
    typeof urlOrOptions === 'object' ? (urlOrOptions.postgresOptions ?? {}) : {};

  const sql = postgres(url, postgresOptions);
  const db = drizzle(sql, { schema, casing: 'snake_case' });

  return {
    db,
    sql,
    end: () => sql.end({ timeout: 5 }),
  };
}
