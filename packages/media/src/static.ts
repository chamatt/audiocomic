import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { zipSync, strToU8 } from 'fflate';

import type { ExportResult } from './types.js';

// ============================================================================
// Static page export — bundle / PDF (CBZ fallback)
// ============================================================================

async function fileStats(path: string): Promise<number> {
  const s = await stat(path);
  return s.size;
}

/**
 * Bundle page images into a zip archive or a directory.
 *
 * If `outputPath` ends with `.zip`, a CBZ-style zip is written containing all
 * page images (renamed to a stable zero-padded sequence). Otherwise the images
 * are copied into the directory at `outputPath` (created if missing).
 */
export async function exportPageBundle(
  pageImages: string[],
  outputPath: string,
): Promise<ExportResult> {
  if (pageImages.length === 0) {
    throw new Error('exportPageBundle: no page images supplied');
  }

  const pad = String(pageImages.length).length;

  if (outputPath.toLowerCase().endsWith('.zip')) {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < pageImages.length; i++) {
      const src = pageImages[i]!;
      const ext = extname(src) || '.png';
      const name = `page-${String(i + 1).padStart(pad, '0')}${ext}`;
      files[name] = await readFile(src);
    }
    const zipped = zipSync(files);
    await writeFile(outputPath, zipped);
    return {
      path: outputPath,
      durationSec: 0,
      sizeBytes: await fileStats(outputPath),
    };
  }

  // Directory bundle.
  await mkdir(outputPath, { recursive: true });
  let total = 0;
  for (let i = 0; i < pageImages.length; i++) {
    const src = pageImages[i]!;
    const ext = extname(src) || '.png';
    const dest = join(outputPath, `page-${String(i + 1).padStart(pad, '0')}${ext}`);
    await copyFile(src, dest);
    total += await fileStats(dest);
  }
  return { path: outputPath, durationSec: 0, sizeBytes: total };
}

/**
 * Export page images as a PDF.
 *
 * MVP note: no native PDF library is bundled with this package, so this
 * produces a CBZ (zip of page images) instead — a widely supported comic
 * archive format. The output path's extension is rewritten to `.cbz` and the
 * CBZ path is returned. Callers wanting a real PDF should swap in img2pdf or a
 * headless renderer in a downstream stage.
 */
export async function exportPdf(
  pageImages: string[],
  outputPath: string,
): Promise<ExportResult> {
  if (pageImages.length === 0) {
    throw new Error('exportPdf: no page images supplied');
  }

  const cbzPath =
    outputPath.toLowerCase().endsWith('.pdf') ||
    outputPath.toLowerCase().endsWith('.cbz')
      ? outputPath.replace(/\.(pdf|cbz)$/i, '.cbz')
      : `${outputPath}.cbz`;

  const pad = String(pageImages.length).length;
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < pageImages.length; i++) {
    const src = pageImages[i]!;
    const ext = extname(src) || '.png';
    const name = `page-${String(i + 1).padStart(pad, '0')}${ext}`;
    files[name] = await readFile(src);
  }
  // Minimal ComicInfo.xml so readers detect the archive as a comic.
  const comicInfo =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<ComicInfo xmlns="https://anansi-project.org/docs/comicinfo/schema">' +
    `<PageCount>${pageImages.length}</PageCount>` +
    '</ComicInfo>';
  files['ComicInfo.xml'] = strToU8(comicInfo);

  const zipped = zipSync(files);
  await writeFile(cbzPath, zipped);
  return { path: cbzPath, durationSec: 0, sizeBytes: await fileStats(cbzPath) };
}

// Re-export so callers can reach the basename helper if needed.
export { basename as pageBasename };
