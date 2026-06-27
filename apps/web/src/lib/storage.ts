import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { getEnv } from '@audiocomic/shared';
import { Readable } from 'node:stream';

async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
}

function localPath(key: string): string {
  const env = getEnv();
  return join(env.UPLOAD_DIR, key);
}

export async function writeAsset(key: string, data: Buffer): Promise<void> {
  const path = localPath(key);
  await ensureDir(path);
  await fs.writeFile(path, data);
}

export async function readAsset(key: string): Promise<Buffer> {
  return fs.readFile(localPath(key));
}

export async function assetExists(key: string): Promise<boolean> {
  try {
    await fs.access(localPath(key));
    return true;
  } catch {
    return false;
  }
}

export async function getAssetStream(key: string): Promise<globalThis.ReadableStream> {
  const { createReadStream } = await import('node:fs');
  const nodeStream = createReadStream(localPath(key));
  return Readable.toWeb(nodeStream) as unknown as globalThis.ReadableStream;
}
