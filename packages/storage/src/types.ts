// MediaManager — abstraction over S3-compatible object storage.
// Used by FileRegistryActor, PipelineBridge, and web API routes.

/** Result of an upload operation. */
export interface UploadResult {
  key: string;
  bucket: string;
  size: number;
  etag: string;
  mimeType: string;
}

/** Metadata for a listed object. */
export interface FileInfo {
  key: string;
  size: number;
  lastModified: Date;
}

/**
 * MediaManager — unified interface for storing and retrieving files.
 * Implementations: S3MediaManager (MinIO/any S3), LocalMediaManager (filesystem fallback).
 */
export interface MediaManager {
  /** Upload a buffer or stream to the given key. */
  upload(key: string, data: Buffer | ReadableStream<Uint8Array>, mimeType: string): Promise<UploadResult>;

  /** Download an object as a readable stream. */
  download(key: string): Promise<ReadableStream<Uint8Array>>;

  /** Download an object as a Buffer (for small files). */
  downloadBuffer(key: string): Promise<Buffer>;

  /** Delete an object. */
  delete(key: string): Promise<void>;

  /** Check if an object exists. */
  exists(key: string): Promise<boolean>;

  /** Get object size in bytes. */
  size(key: string): Promise<number>;

  /** Generate a presigned URL for temporary access (S3 only; local returns a relative path). */
  presignedUrl(key: string, expiresIn?: number): Promise<string>;

  /** List objects under a prefix. */
  list(prefix: string): Promise<FileInfo[]>;
}
