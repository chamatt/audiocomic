import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { zipSync, strToU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';

import type { ExportResult } from './types';
// ============================================================================
// Static page export — bundle (CBZ) / PDF
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
 * Export page images as a real PDF using pdf-lib.
 *
 * Each page image (PNG, JPEG) is embedded at its native pixel dimensions
 * (72 DPI mapping: 1px = 1pt). The output path's extension is forced to
 * `.pdf`.
 */
export async function exportPdf(
  pageImages: string[],
  outputPath: string,
): Promise<ExportResult> {
  if (pageImages.length === 0) {
    throw new Error('exportPdf: no page images supplied');
  }

  const pdfPath = outputPath.toLowerCase().endsWith('.pdf')
    ? outputPath
    : `${outputPath}.pdf`;

  const doc = await PDFDocument.create();

  for (const src of pageImages) {
    const bytes = await readFile(src);
    const ext = extname(src).toLowerCase();
    let img;
    if (ext === '.jpg' || ext === '.jpeg') {
      img = await doc.embedJpg(bytes);
    } else {
      // Default to PNG for .png and anything else — pdf-lib will throw
      // if the bytes aren't valid PNG, which is the right behavior.
      img = await doc.embedPng(bytes);
    }
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }

  const pdfBytes = await doc.save();
  await writeFile(pdfPath, pdfBytes);
  return { path: pdfPath, durationSec: 0, sizeBytes: await fileStats(pdfPath) };
}

// Re-export so callers can reach the basename helper if needed.
export { basename as pageBasename };
