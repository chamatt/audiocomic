// S3MediaManager — S3-compatible object storage implementation.
// Works with MinIO (local Docker), AWS S3, Cloudflare R2, or any S3-compatible provider.

import type { MediaManager, UploadResult, FileInfo } from './types.ts';

export interface S3MediaManagerOptions {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Use path-style addressing (required for MinIO). */
  forcePathStyle?: boolean;
}

export function createS3MediaManager(opts: S3MediaManagerOptions): MediaManager {
  // Lazy-load AWS SDK — optional dependency, only needed when S3 is used
  let s3Client: unknown = null;
  let presigner: unknown = null;

  async function getClient() {
    if (s3Client) return s3Client;

    const { S3Client } = await import('@aws-sdk/client-s3');
    s3Client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      forcePathStyle: opts.forcePathStyle ?? false,
    });
    return s3Client;
  }

  async function getPresigner() {
    if (presigner) return presigner;

    const { S3RequestPresigner } = await import('@aws-sdk/s3-request-presigner');
    const { Sha256 } = await import('@aws-crypto/sha256-js');

    presigner = new S3RequestPresigner({
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      region: opts.region,
      sha256: Sha256,
    });
    return presigner;
  }

  return {
    async upload(key: string, data: Buffer | ReadableStream<Uint8Array>, mimeType: string): Promise<UploadResult> {
      const client = await getClient();
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');

      let body: Buffer | ReadableStream<Uint8Array>;
      if (Buffer.isBuffer(data)) {
        body = data;
      } else {
        body = data;
      }

      const command = new PutObjectCommand({
        Bucket: opts.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
      });

      const response = await (client as { send: (cmd: unknown) => Promise<{ ETag?: string }> }).send(command);

      // Get size from the buffer if available, otherwise from the response
      const size = Buffer.isBuffer(data) ? data.length : 0;

      return {
        key,
        bucket: opts.bucket,
        size,
        etag: response.ETag?.replace(/"/g, '') ?? '',
        mimeType,
      };
    },

    async download(key: string): Promise<ReadableStream<Uint8Array>> {
      const client = await getClient();
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');

      const command = new GetObjectCommand({
        Bucket: opts.bucket,
        Key: key,
      });

      const response = await (client as { send: (cmd: unknown) => Promise<{ Body?: { transformToWebStream: () => ReadableStream<Uint8Array> } }> }).send(command);

      if (!response.Body) {
        throw new Error(`Object not found: ${key}`);
      }

      return response.Body.transformToWebStream();
    },

    async downloadBuffer(key: string): Promise<Buffer> {
      const stream = await this.download(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    },

    async delete(key: string): Promise<void> {
      const client = await getClient();
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');

      const command = new DeleteObjectCommand({
        Bucket: opts.bucket,
        Key: key,
      });

      await (client as { send: (cmd: unknown) => Promise<unknown> }).send(command);
    },

    async exists(key: string): Promise<boolean> {
      const client = await getClient();
      const { HeadObjectCommand } = await import('@aws-sdk/client-s3');

      const command = new HeadObjectCommand({
        Bucket: opts.bucket,
        Key: key,
      });

      try {
        await (client as { send: (cmd: unknown) => Promise<unknown> }).send(command);
        return true;
      } catch {
        return false;
      }
    },

    async size(key: string): Promise<number> {
      const client = await getClient();
      const { HeadObjectCommand } = await import('@aws-sdk/client-s3');

      const command = new HeadObjectCommand({
        Bucket: opts.bucket,
        Key: key,
      });

      const response = await (client as { send: (cmd: unknown) => Promise<{ ContentLength?: number }> }).send(command);
      return response.ContentLength ?? 0;
    },

    async presignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const signer = await getPresigner();

      const command = new GetObjectCommand({
        Bucket: opts.bucket,
        Key: key,
      });

      return getSignedUrl(signer as never, command, { expiresIn });
    },

    async list(prefix: string): Promise<FileInfo[]> {
      const client = await getClient();
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');

      const command = new ListObjectsV2Command({
        Bucket: opts.bucket,
        Prefix: prefix,
      });

      const response = await (client as { send: (cmd: unknown) => Promise<{ Contents?: Array<{ Key?: string; Size?: number; LastModified?: Date }> }> }).send(command);

      return (response.Contents ?? []).map((obj) => ({
        key: obj.Key ?? '',
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ?? new Date(),
      }));
    },
  };
}
