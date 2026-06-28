import { createHash } from 'node:crypto';
import { storageKey } from '@audiocomic/shared';
import type { Env } from '@audiocomic/shared';
import { createMediaManagerFromEnv, type MediaManager } from '@audiocomic/storage';

/**
 * Short stable hash of the prompt for provenance tracking on
 * {@link PanelRenderResult}. Truncated to keep storage records compact.
 */
export function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

// Cached MediaManager instances per env — created lazily.
const mediaManagerCache = new WeakMap<Env, MediaManager>();

function getMediaManager(env: Env): MediaManager {
  let mm = mediaManagerCache.get(env);
  if (!mm) {
    mm = createMediaManagerFromEnv(env);
    mediaManagerCache.set(env, mm);
  }
  return mm;
}

/**
 * Persist image bytes to object storage under a storage key.
 * Uses MediaManager (S3-compatible or local filesystem) under the hood.
 * Returns the storage key (not a filesystem path).
 */
export async function writeLocalImage(env: Env, key: string, data: Uint8Array): Promise<string> {
  const mm = getMediaManager(env);
  const buf = data instanceof Buffer ? data : Buffer.from(data);
  await mm.upload(key, buf, 'image/png');
  return key;
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
