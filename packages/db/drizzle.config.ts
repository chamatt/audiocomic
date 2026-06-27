import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// Load .env from monorepo root, overriding any pre-existing shell env vars
config({ path: '../../.env', override: true });

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://audiocomic:audiocomic@localhost:5432/audiocomic',
  },
});
