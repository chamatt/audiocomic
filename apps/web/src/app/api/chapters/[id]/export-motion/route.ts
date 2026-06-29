import { NextResponse, type NextRequest } from 'next/server';
import { getRepo } from '@/lib/db';
import { readAsset, writeAsset } from '@/lib/storage';
import { logger, getEnv, uuid, nowIso } from '@audiocomic/shared';
import { exportMotionComic } from '@audiocomic/media';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import type { NarrationTimeline, NarrationSegment } from '@audiocomic/domain';

const log = logger.scoped('api:chapter:export-motion');

// POST /api/chapters/[id]/export-motion
// Creates a motion comic MP4 for a single chapter:
//   ken-burns slideshow of individual panel images (no page compositing)
//   synced to the chapter's original audio. Each panel is one slide.
//   Saves the MP4 to storage and returns its URL.
//   Each export is persisted as a separate ExportBundle so the user can
//   see and download multiple exports per chapter.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chapterId } = await params;
  const env = getEnv();
  const tmpDir = await mkdtemp(join(tmpdir(), 'audiocomic-export-'));
  const exportDir = env.EXPORT_DIR ?? '/tmp/audiocomic-exports';

  try {
    const repo = await getRepo();

    // ── 1. Load chapter ──
    const chapter = await repo.chapters.getById(chapterId);
    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }
    const projectId = chapter.projectId;

    // ── 2. Load pages for this chapter (to get panel order) ──
    const allPages = await repo.pageSpecs.getByProjectId(projectId);
    const chapterPages = allPages
      .filter((p) => p.chapterId === chapterId)
      .sort((a, b) => a.index - b.index);

    if (chapterPages.length === 0) {
      return NextResponse.json({ error: 'No pages found for this chapter' }, { status: 400 });
    }

    // ── 3. Load panels + render results ──
    const allPanels = await repo.panelSpecs.getByProjectId(projectId);
    const allResults = await repo.panelRenderResults.getByProjectId(projectId);

    // Build a map: renderResultId → imageKey
    const resultByKey = new Map<string, string>();
    for (const r of allResults) {
      if (r.imageKey) resultByKey.set(r.id, r.imageKey);
    }

    // ── 4. Collect rendered panel images in reading order ──
    // Each panel is a slide — no page compositing.
    // Uses panel.renderResultId (authoritative) to find the current image.
    const slides: {
      panelId: string;
      imageKey: string;
      dialogue: { speaker: string; text: string; type: string }[];
    }[] = [];

    for (const page of chapterPages) {
      const pagePanels = allPanels
        .filter((p) => p.pageId === page.id)
        .sort((a, b) => a.index - b.index);

      for (const panel of pagePanels) {
        if (!panel.renderResultId) continue;
        const key = resultByKey.get(panel.renderResultId);
        if (key) {
          slides.push({
            panelId: panel.id,
            imageKey: key,
            dialogue: (panel.dialogueLines ?? []).map((d) => ({
              speaker: d.speaker,
              text: d.text,
              type: d.type,
            })),
          });
        }
      }
    }

    if (slides.length === 0) {
      return NextResponse.json({ error: 'No rendered panels found. Render some panels first.' }, { status: 400 });
    }

    log.info(`Chapter "${chapter.title}": ${slides.length} panel slides`);

    // ── 5. Download chapter audio to temp ──
    const audioAssets = (await repo.sourceAssets.getByProjectId(projectId))
      .filter((a) => a.modality === 'audio' && a.chapterId === chapterId);

    if (audioAssets.length === 0) {
      return NextResponse.json({ error: 'No audio asset linked to this chapter' }, { status: 400 });
    }

    const audioAsset = audioAssets[0]!;
    const audioExt = audioAsset.filename?.split('.').pop() ?? 'm4b';
    const audioPath = join(tmpDir, `audio.${audioExt}`);
    const audioBuf = await readAsset(audioAsset.storageKey);
    await writeFile(audioPath, audioBuf);
    log.info(`Downloaded audio: ${audioAsset.filename} (${audioBuf.length} bytes)`);

    // ── 6. Probe audio duration ──
    const durationStr = await new Promise<string>((resolve, reject) => {
      execFile('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        audioPath,
      ], { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`ffprobe failed: ${stderr}`));
        else resolve(stdout.trim());
      });
    });
    const audioDuration = parseFloat(durationStr);
    log.info(`Audio duration: ${audioDuration.toFixed(1)}s`);

    // ── 7. Build narration timeline — one ken-burns segment per panel ──
    const perSlideDuration = audioDuration / slides.length;
    const segments: NarrationSegment[] = [];
    let currentTime = 0;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i]!;
      // Use panelId as both panelId and pageId — each panel is its own "page"
      const slideId = `slide-${i}`;
      segments.push({
        panelId: slide.panelId,
        pageId: slideId,
        startSec: currentTime,
        endSec: currentTime + perSlideDuration,
        motion: 'ken-burns',
        motionParams: { zoomStart: 1.0, zoomEnd: 1.15, panX: 0, panY: 0 },
        text: `Panel ${i + 1}`,
      });
      currentTime += perSlideDuration;
    }

    const timeline: NarrationTimeline = {
      id: uuid(),
      projectId,
      segments,
      totalDurationSec: audioDuration,
      ttsGenerated: false,
    };

    // ── 8. Download panel images and overlay dialogue bubbles ──
    // Each slide gets its own temp file with dialogue composited on top.
    const pageImageMap = new Map<string, string>();
    const sharp = (await import('sharp')).default;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i]!;
      const slideId = `slide-${i}`;
      const imgPath = join(tmpDir, `slide-${i}.png`);
      const buf = await readAsset(slide.imageKey);

      // Get image dimensions
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

      if (overlaySvg) {
        await sharp(buf)
          .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
          .png()
          .toFile(imgPath);
      } else {
        await sharp(buf).png().toFile(imgPath);
      }
      pageImageMap.set(slideId, imgPath);
    }

    // ── 9. Render motion comic MP4 ──
    const exportId = uuid();
    const mp4Key = `projects/${projectId}/chapters/${chapterId}/exports/${exportId}.mp4`;
    const localMp4Path = join(exportDir, mp4Key);
    await mkdir(join(exportDir, `projects/${projectId}/chapters/${chapterId}/exports`), { recursive: true });

    log.info(`Rendering motion comic: ${slides.length} slides, ${audioDuration.toFixed(1)}s audio`);

    const result = await exportMotionComic(
      timeline,
      pageImageMap,
      audioPath,
      localMp4Path,
      { ffmpegBin: 'ffmpeg', width: 1280, height: 720, fps: 24 },
    );

    log.info(`Motion comic rendered: ${result.sizeBytes} bytes, ${result.durationSec}s`);

    // ── 10. Upload MP4 to storage ──
    const mp4Buffer = await readFile(localMp4Path);
    await writeAsset(mp4Key, mp4Buffer);

    // ── 11. Persist export bundle (chapter-scoped) ──
    await repo.exportBundles.create({
      id: exportId,
      projectId,
      type: 'mp4',
      storageKey: mp4Key,
      createdAt: nowIso(),
      sizeBytes: result.sizeBytes,
      metadata: {
        chapterId,
        chapterTitle: chapter.title,
        durationSec: result.durationSec,
        slides: slides.length,
        audioAssetId: audioAsset.id,
      },
    });

    log.info(`Export saved: ${mp4Key}`);

    return NextResponse.json({
      chapterId,
      exportId,
      mp4Url: `/api/assets/${mp4Key}`,
      sizeBytes: result.sizeBytes,
      durationSec: result.durationSec,
      slides: slides.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('Motion export failed', { chapterId, error: msg, stack: e instanceof Error ? e.stack : undefined });
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
