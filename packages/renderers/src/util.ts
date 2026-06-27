import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { storageKey } from '@audiocomic/shared';
import type { Env } from '@audiocomic/shared';

/**
 * Short stable hash of the prompt for provenance tracking on
 * {@link PanelRenderResult}. Truncated to keep storage records compact.
 */
export function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

/**
 * Persist image bytes to the local upload directory under a storage key.
 * The storage key is treated as a relative path beneath `UPLOAD_DIR`, which
 * matches the local-storage mode (`STORAGE_USE_LOCAL=true`).
 */
export async function writeLocalImage(env: Env, key: string, data: Uint8Array): Promise<string> {
  const path = join(env.UPLOAD_DIR, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return path;
}

/**
 * Build a storage key for a rendered panel image with an explicit extension,
 * reusing the shared `storageKey` scheme so keys stay consistent across the
 * local and remote object-storage backends.
 */
export function panelRenderKey(
  projectId: string,
  panelId: string,
  version: number,
  ext: string,
): string {
  return storageKey(projectId, 'panels', `${panelId}-v${version}.${ext}`);
}
