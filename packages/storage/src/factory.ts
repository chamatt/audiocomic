// Factory — creates the appropriate MediaManager based on environment.
// If STORAGE_ENDPOINT is set → S3MediaManager (MinIO or any S3).
// Otherwise → LocalMediaManager (filesystem fallback).

import type { MediaManager } from './types.ts';
import { createLocalMediaManager } from './local.ts';
import { createS3MediaManager } from './s3.ts';

export interface MediaManagerConfig {
  /** S3 endpoint URL. If set, uses S3MediaManager. */
  endpoint?: string;
  /** S3 region. */
  region?: string;
  /** S3 bucket name. */
  bucket?: string;
  /** S3 access key ID. */
  accessKeyId?: string;
  /** S3 secret access key. */
  secretAccessKey?: string;
  /** Use path-style addressing (for MinIO). */
  forcePathStyle?: boolean;
  /** Local filesystem base directory (for LocalMediaManager fallback). */
  localBaseDir: string;
}

export function createMediaManager(config: MediaManagerConfig): MediaManager {
  // Use S3 if endpoint + credentials are provided
  if (
    config.endpoint &&
    config.accessKeyId &&
    config.secretAccessKey
  ) {
    return createS3MediaManager({
      endpoint: config.endpoint,
      region: config.region ?? 'us-east-1',
      bucket: config.bucket ?? 'audiocomic',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: config.forcePathStyle ?? true,
    });
  }

  // Fallback to local filesystem
  return createLocalMediaManager({
    baseDir: config.localBaseDir,
    bucket: config.bucket ?? 'local',
  });
}

/**
 * Create a MediaManager from environment variables (EnvSchema from @audiocomic/shared).
 */
export function createMediaManagerFromEnv(env: {
  STORAGE_ENDPOINT?: string;
  STORAGE_REGION?: string;
  STORAGE_BUCKET?: string;
  STORAGE_ACCESS_KEY?: string;
  STORAGE_SECRET_KEY?: string;
  STORAGE_USE_LOCAL?: boolean;
  UPLOAD_DIR: string;
}): MediaManager {
  // If STORAGE_USE_LOCAL is explicitly true, skip S3 even if endpoint is set
  if (env.STORAGE_USE_LOCAL) {
    return createLocalMediaManager({
      baseDir: env.UPLOAD_DIR,
      bucket: env.STORAGE_BUCKET ?? 'local',
    });
  }

  return createMediaManager({
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    bucket: env.STORAGE_BUCKET,
    accessKeyId: env.STORAGE_ACCESS_KEY,
    secretAccessKey: env.STORAGE_SECRET_KEY,
    forcePathStyle: true,
    localBaseDir: env.UPLOAD_DIR,
  });
}
