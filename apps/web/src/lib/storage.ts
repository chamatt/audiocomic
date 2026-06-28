// Storage layer — delegates to @audiocomic/storage MediaManager.
// Provides backward-compatible writeAsset/readAsset/assetExists/getAssetStream
// for existing web app code, while using S3-compatible storage under the hood.

import { getEnv, logger } from '@audiocomic/shared';
import { createMediaManagerFromEnv, type MediaManager } from '@audiocomic/storage';

const log = logger.scoped('web:storage');
let _mediaManager: MediaManager | null = null;
function getMediaManager(): MediaManager {
  if (!_mediaManager) {
    log.info('initializing media manager from env');
    _mediaManager = createMediaManagerFromEnv(getEnv());
  }
  return _mediaManager;
}

export async function writeAsset(key: string, data: Buffer): Promise<void> {
  await getMediaManager().upload(key, data, 'application/octet-stream');
}

export async function readAsset(key: string): Promise<Buffer> {
  return getMediaManager().downloadBuffer(key);
}

export async function assetExists(key: string): Promise<boolean> {
  return getMediaManager().exists(key);
}

export async function getAssetStream(key: string): Promise<globalThis.ReadableStream> {
  return getMediaManager().download(key);
}

export async function deleteAsset(key: string): Promise<void> {
  await getMediaManager().delete(key);
}

export async function assetSize(key: string): Promise<number> {
  return getMediaManager().size(key);
}

/** Get the underlying MediaManager for direct S3 operations. */
export function getStorageManager(): MediaManager {
  return getMediaManager();
}
