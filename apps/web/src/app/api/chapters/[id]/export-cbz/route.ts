import { NextResponse, type NextRequest } from 'next/server';
import { getRepo } from '@/lib/db';
import { readAsset, writeAsset } from '@/lib/storage';
import { logger, uuid, nowIso } from '@audiocomic/shared';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PanelSpec } from '@audiocomic/domain';

const log = logger.scoped('api:chapter:export-cbz');

// POST /api/chapters/[id]/export-cbz
// Exports all rendered panels for a chapter as a CBZ file (ZIP of images
// named in reading order: 001.jpg, 002.jpg, ...). Saves to storage and
// returns the URL. Each export is persisted as a separate ExportBundle.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;
  const tmpDir = await mkdtemp(join(tmpdir(), 'audiocomic-cbz-'));

  try {
    const repo = await getRepo();

    // ── 1. Load chapter ──
    const chapter = await repo.chapters.getById(chapterId);
    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }
    const projectId = chapter.projectId;

    // ── 2. Load pages + panels in reading order ──
    const allPages = await repo.pageSpecs.getByProjectId(projectId);
    const chapterPages = allPages
      .filter((p) => p.chapterId === chapterId)
      .sort((a, b) => a.index - b.index);

    if (chapterPages.length === 0) {
      return NextResponse.json({ error: 'No pages found for this chapter' }, { status: 400 });
    }

    const allPanels = await repo.panelSpecs.getByProjectId(projectId);
    const allResults = await repo.panelRenderResults.getByProjectId(projectId);

    // Build a map: renderResultId → imageKey (for lookup via panel.renderResultId)
    const resultByKey = new Map<string, string>();
    for (const r of allResults) {
      if (r.imageKey) resultByKey.set(r.id, r.imageKey);
    }

    // ── 3. Collect panel images in reading order ──
    // Use panel.renderResultId to find the current render — this is the
    // authoritative link set by the render API, not a "latest by createdAt"
    // heuristic that can pick stale/deleted files.
    const slideImages: { panelId: string; imageKey: string; dialogue: PanelSpec['dialogueLines'] }[] = [];

    for (const page of chapterPages) {
      const pagePanels = allPanels
        .filter((p) => p.pageId === page.id)
        .sort((a, b) => a.index - b.index);

      for (const panel of pagePanels) {
        if (!panel.renderResultId) continue;
        const key = resultByKey.get(panel.renderResultId);
        if (key) {
          slideImages.push({
            panelId: panel.id,
            imageKey: key,
            dialogue: panel.dialogueLines ?? [],
          });
        }
      }
    }

    if (slideImages.length === 0) {
      return NextResponse.json({ error: 'No rendered panels found. Render some panels first.' }, { status: 400 });
    }

    log.info(`Chapter "${chapter.title}": ${slideImages.length} panels for CBZ`);

    // ── 4. Download images and overlay dialogue bubbles ──
    const sharp = (await import('sharp')).default;
    const imagePaths: string[] = [];

    for (let i = 0; i < slideImages.length; i++) {
      const slide = slideImages[i]!;
      let buf: Buffer;
      try {
        buf = await readAsset(slide.imageKey);
      } catch {
        log.warn(`Skipping panel — image file missing: ${slide.imageKey}`);
        continue;
      }
      const meta = await sharp(buf).metadata();
      const w = meta.width ?? 1024;
      const h = meta.height ?? 1024;

      // Build SVG overlay with dialogue bubbles
      let overlaySvg = '';
      if (slide.dialogue.length > 0) {
        const boxes = slide.dialogue.map((d, idx) => {
          const text = `${d.speaker}: ${d.text}`;
          const fontSize = Math.round(w * 0.035);
          const padding = fontSize * 0.6;
          const maxCharsPerLine = Math.floor((w * 0.7) / (fontSize * 0.55));
          const lines = wrapTextSvg(text, maxCharsPerLine);
          const boxW = Math.min(w * 0.75, Math.max(...lines.map((l) => l.length)) * fontSize * 0.55 + padding * 2);
          const boxH = lines.length * fontSize * 1.3 + padding * 2;
          const boxX = w * 0.05;
          const boxY = h * 0.03 + idx * (boxH + 10);
          const escapedLines = lines.map((l) => escapeXmlSvg(l));
          const tspans = escapedLines.map((l, li) =>
            `<tspan x="${boxX + padding}" y="${boxY + padding + fontSize + li * fontSize * 1.3}">${l}</tspan>`
          ).join('');
          const bgColor = d.type === 'narration' ? 'rgba(255,255,240,0.85)' : 'rgba(255,255,255,0.9)';
          const borderColor = d.type === 'narration' ? '#ccc' : '#333';
          return `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="8" fill="${bgColor}" stroke="${borderColor}" stroke-width="2"/><text font-family="Arial, sans-serif" font-size="${fontSize}" fill="#111" font-weight="bold">${tspans}</text>`;
        });
        overlaySvg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${boxes.join('')}</svg>`;
      }

      const imgPath = join(tmpDir, `${String(i + 1).padStart(3, '0')}.jpg`);
      if (overlaySvg) {
        await sharp(buf)
          .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
          .jpeg({ quality: 90 })
          .toFile(imgPath);
      } else {
        await sharp(buf).jpeg({ quality: 90 }).toFile(imgPath);
      }
      imagePaths.push(imgPath);
    }

    // ── 5. Create CBZ (ZIP) file ──
    const { execFile } = await import('node:child_process');
    const cbzPath = join(tmpDir, 'export.cbz');

    // Use zip command — simpler than archiver dependency
    await new Promise<void>((resolve, reject) => {
      execFile('zip', ['-j', cbzPath, ...imagePaths], { timeout: 60000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(`zip failed: ${stderr}`));
        else resolve();
      });
    });

    const cbzBuffer = await readFile(cbzPath);
    log.info(`CBZ created: ${cbzBuffer.length} bytes, ${slideImages.length} images`);

    // ── 6. Upload to storage ──
    const exportId = uuid();
    const cbzKey = `projects/${projectId}/chapters/${chapterId}/exports/${exportId}.cbz`;
    await writeAsset(cbzKey, cbzBuffer);

    // ── 7. Persist export bundle ──
    await repo.exportBundles.create({
      id: exportId,
      projectId,
      type: 'cbz',
      storageKey: cbzKey,
      createdAt: nowIso(),
      sizeBytes: cbzBuffer.length,
      metadata: {
        chapterId,
        chapterTitle: chapter.title,
        slides: slideImages.length,
      },
    });

    log.info(`CBZ export saved: ${cbzKey}`);

    return NextResponse.json({
      chapterId,
      exportId,
      cbzUrl: `/api/assets/${cbzKey}`,
      sizeBytes: cbzBuffer.length,
      slides: slideImages.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('CBZ export failed', { chapterId, error: msg, stack: e instanceof Error ? e.stack : undefined });
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── SVG helpers for dialogue bubble overlay ──
function escapeXmlSvg(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapTextSvg(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars && current) {
      lines.push(current.trim());
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines.length > 0 ? lines : [''];
}
