// LocalMediaManager — filesystem-backed implementation for dev without Docker/MinIO.
// Same interface as S3MediaManager, writes to UPLOAD_DIR.

import { promises as fs } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { MediaManager, UploadResult, FileInfo } from './types.ts';

export interface LocalMediaManagerOptions {
  /** Root directory for stored files. */
  baseDir: string;
  /** Bucket name (used in UploadResult for interface compatibility). */
  bucket?: string;
}

export function createLocalMediaManager(opts: LocalMediaManagerOptions): MediaManager {
  const baseDir = opts.baseDir;
  const bucket = opts.bucket ?? 'local';

  function fullPath(key: string): string {
    // Prevent path traversal — resolve relative to baseDir
    const resolved = join(baseDir, key);
    if (!resolved.startsWith(baseDir)) {
      throw new Error(`Path traversal detected: ${key}`);
    }
    return resolved;
  }

  async function ensureDir(path: string): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true });
  }

  return {
    async upload(key: string, data: Buffer | ReadableStream<Uint8Array>, mimeType: string): Promise<UploadResult> {
      const path = fullPath(key);
      await ensureDir(path);

      let buf: Buffer;
      if (Buffer.isBuffer(data)) {
        buf = data;
      } else {
        // Consume stream into buffer — ReadableStream is async iterable
        const chunks: Buffer[] = [];
        const iterable = data as unknown as AsyncIterable<Uint8Array>;
        for await (const chunk of iterable) {
          chunks.push(Buffer.from(chunk));
        }
        buf = Buffer.concat(chunks);
      }

      await fs.writeFile(path, buf);
      const stat = await fs.stat(path);

      return {
        key,
        bucket,
        size: stat.size,
        etag: stat.size.toString(36),
        mimeType,
      };
    },

    async download(key: string): Promise<ReadableStream<Uint8Array>> {
      const path = fullPath(key);
      const nodeStream = createReadStream(path);
      return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    },

    async downloadBuffer(key: string): Promise<Buffer> {
      const path = fullPath(key);
      return fs.readFile(path);
    },

    async delete(key: string): Promise<void> {
      const path = fullPath(key);
      try {
        await fs.unlink(path);
      } catch {
        // Ignore — already deleted
      }
    },

    async exists(key: string): Promise<boolean> {
      const path = fullPath(key);
      try {
        await fs.access(path);
        return true;
      } catch {
        return false;
      }
    },

    async size(key: string): Promise<number> {
      const path = fullPath(key);
      const stat = await fs.stat(path);
      return stat.size;
    },

    async presignedUrl(key: string): Promise<string> {
      // Local: return a relative API path that the web app can serve
      return `/api/assets/${key.split(sep).join('/')}`;
    },

    async list(prefix: string): Promise<FileInfo[]> {
      const dir = fullPath(prefix);
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const results: FileInfo[] = [];
        for (const entry of entries) {
          if (entry.isFile()) {
            const stat = await fs.stat(join(dir, entry.name));
            results.push({
              key: `${prefix}/${entry.name}`,
              size: stat.size,
              lastModified: stat.mtime,
            });
          }
        }
        return results;
      } catch {
        return [];
      }
    },
  };
}
