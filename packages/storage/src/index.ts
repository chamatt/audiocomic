// @audiocomic/storage — S3-compatible object storage abstraction.

export type { MediaManager, UploadResult, FileInfo } from './types.ts';
export { createLocalMediaManager } from './local.ts';
export type { LocalMediaManagerOptions } from './local.ts';
export { createS3MediaManager } from './s3.ts';
export type { S3MediaManagerOptions } from './s3.ts';
export { createMediaManager, createMediaManagerFromEnv } from './factory.ts';
export type { MediaManagerConfig } from './factory.ts';
