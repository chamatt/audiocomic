import { mkdtemp, rm, writeFile, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import type { NarrationSegment, NarrationTimeline } from '@audiocomic/domain';

import type { ExportResult } from './types';

// ============================================================================
// Motion-comic export via FFmpeg
// ============================================================================
//
// Strategy: render each segment as an independent short MP4 (parallel across
// CPU cores), then concat with the demuxer (stream copy — no re-encode) and
// mux audio. This is dramatically faster and lower-memory than building one
// giant filter_complex graph with N inputs.
//
// When motion is disabled (motion: 'none' in options), segments are rendered
// as static holds — no zoompan filter, just a looped image turned into video.

/** A page image source: either an in-memory buffer or a filesystem path. */
export type PageImageSource = Buffer | string;

export interface MotionExportOptions {
  /** FFmpeg binary path (defaults to FFMPEG_BIN env or "ffmpeg"). */
  ffmpegBin?: string;
  /** Output width in pixels. */
  width?: number;
  /** Output height in pixels. */
  height?: number;
  /** Frame rate for the generated video. */
  fps?: number;
  /** Disable zoompan motion entirely (static slideshow). Default: false. */
  disableMotion?: boolean;
  /** Max concurrent segment renders. Default: 4. */
  concurrency?: number;
  /** Optional progress callback: (completed, total) => void. */
  onProgress?: (completed: number, total: number) => void;
}

interface ResolvedMotion {
  ffmpegBin: string;
  width: number;
  height: number;
  fps: number;
  disableMotion: boolean;
  concurrency: number;
  onProgress?: (completed: number, total: number) => void;
}

function resolveOptions(
  env: string | MotionExportOptions | undefined,
): ResolvedMotion {
  if (typeof env === 'string') {
    return {
      ffmpegBin: env || (process.env.FFMPEG_BIN ?? 'ffmpeg'),
      width: 1280,
      height: 720,
      fps: 24,
      disableMotion: false,
      concurrency: 4,
    };
  }
  const o = env ?? {};
  return {
    ffmpegBin: o.ffmpegBin || (process.env.FFMPEG_BIN ?? 'ffmpeg'),
    width: o.width ?? 1280,
    height: o.height ?? 720,
    fps: o.fps ?? 24,
    disableMotion: o.disableMotion ?? false,
    concurrency: o.concurrency ?? 4,
    onProgress: o.onProgress,
  };
}

/** Spawn a binary, capturing output; throw on non-zero exit. */
async function runBin(
  bin: string,
  args: string[],
  captureStderr = true,
): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  proc.on('error', reject);
  proc.on('close', (code) => {
    if (code !== 0) {
      const detail = captureStderr ? stderr.trim() : '';
      reject(new Error(`${bin} exited with code ${code}\n${detail}`));
    } else {
      resolve();
    }
  });
  await promise;
}

// ----------------------------------------------------------------------------
// Per-segment rendering
// ----------------------------------------------------------------------------

/**
 * Build the FFmpeg args to render a single segment to its own MP4 file.
 * Uses `-loop 1 -t DURATION` for the input, a single filter chain, and
 * libx264 output. When motion is disabled, the filter is just scale+pad
 * (no zoompan).
 */
function buildSegmentArgs(
  seg: NarrationSegment,
  opts: ResolvedMotion,
  imgPath: string,
  outputPath: string,
): string[] {
  const { width: W, height: H, fps } = opts;
  const dur = Math.max(0.1, seg.endSec - seg.startSec);
  const frames = Math.max(1, Math.round(dur * fps));

  const scalePad = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

  let vf: string;

  if (opts.disableMotion || seg.motion === 'static') {
    // Static hold: loop the image for the duration, no zoompan.
    vf = `${scalePad},fps=${fps},trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS`;
  } else {
    // zoompan: single image input (no -loop), output `frames` frames via `d`.
    const p = seg.motionParams;
    const zoomStart = p.zoomStart;
    const zoomEnd = p.zoomEnd;
    const panX = p.panX;
    const panY = p.panY;
    const zoompanSuffix = `:d=${frames}:s=${W}x${H}:fps=${fps}`;

    switch (seg.motion) {
      case 'zoom-in': {
        const z = `if(lte(on,0),${zoomStart},min(${zoomEnd},${zoomStart}+(${zoomEnd}-${zoomStart})*on/${frames}))`;
        const x = `iw/2-(iw/zoom/2)`;
        const y = `ih/2-(ih/zoom/2)`;
        vf = `${scalePad},zoompan=z='${z}':x='${x}':y='${y}'${zoompanSuffix}`;
        break;
      }
      case 'zoom-out': {
        const z = `if(lte(on,0),${zoomStart},max(${zoomEnd},${zoomStart}-(${zoomStart}-${zoomEnd})*on/${frames}))`;
        const x = `iw/2-(iw/zoom/2)`;
        const y = `ih/2-(ih/zoom/2)`;
        vf = `${scalePad},zoompan=z='${z}':x='${x}':y='${y}'${zoompanSuffix}`;
        break;
      }
      case 'ken-burns': {
        const z = `${zoomStart}+(${zoomEnd}-${zoomStart})*on/${frames}`;
        const x = `iw/2-(iw/zoom/2)+(${panX})*on/${frames}*iw*0.1`;
        const y = `ih/2-(ih/zoom/2)+(${panY})*on/${frames}*ih*0.1`;
        vf = `${scalePad},zoompan=z='${z}':x='${x}':y='${y}'${zoompanSuffix}`;
        break;
      }
      case 'pan-left': {
        const z = `${zoomStart}`;
        const x = `(iw-iw/zoom)*(1-on/${frames})`;
        const y = `ih/2-(ih/zoom/2)`;
        vf = `${scalePad},zoompan=z='${z}':x='${x}':y='${y}'${zoompanSuffix}`;
        break;
      }
      case 'pan-right': {
        const z = `${zoomStart}`;
        const x = `(iw-iw/zoom)*on/${frames}`;
        const y = `ih/2-(ih/zoom/2)`;
        vf = `${scalePad},zoompan=z='${z}':x='${x}':y='${y}'${zoompanSuffix}`;
        break;
      }
      default:
        vf = `${scalePad},fps=${fps},trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS`;
        break;
    }
  }
  // For zoompan segments: read the image as a single frame (no -loop).
  // zoompan's `d` parameter produces the full output frame count from
  // that single input frame. Using -loop 1 causes ffmpeg to decode every
  // looped frame even though select discards them — extremely slow.
  const isZoompan = !opts.disableMotion && seg.motion !== 'static';

  if (isZoompan) {
    return [
      '-y',
      '-i', imgPath,
      '-vf', vf,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      outputPath,
    ];
  }

  // Static hold: loop the image for the full duration.
  return [
    '-y',
    '-loop', '1',
    '-i', imgPath,
    '-vf', vf,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-t', dur.toFixed(3),
    outputPath,
  ];
}

/** Render a single segment to a temp MP4. */
async function renderSegment(
  seg: NarrationSegment,
  opts: ResolvedMotion,
  imgPath: string,
  outputPath: string,
): Promise<void> {
  const args = buildSegmentArgs(seg, opts, imgPath, outputPath);
  await runBin(opts.ffmpegBin, args);
}

/**
 * Run async tasks with bounded concurrency.
 * Calls onProgress after each task completes.
 */
async function runPool<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  let done = 0;
  const total = tasks.length;

  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= total) return;
      results[idx] = await tasks[idx]!();
      done++;
      onProgress?.(done, total);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ----------------------------------------------------------------------------
// Main export function
// ----------------------------------------------------------------------------

/**
 * Export a motion comic (MP4) from a narration timeline and per-page images.
 *
 * Each NarrationSegment becomes a video segment of duration `endSec - startSec`
 * with a Ken Burns / zoom / pan motion applied to its page image. Segments are
 * rendered in parallel as individual MP4s, then concatenated via the demuxer
 * (stream copy) and muxed with the supplied audio track.
 *
 * When `disableMotion` is set, segments are static holds (no zoompan) — much
 * faster, suitable when motion is not needed.
 *
 * Page images may be supplied as filesystem paths or in-memory buffers; buffers
 * are written to a temp directory for the duration of the render.
 */
export async function exportMotionComic(
  timeline: NarrationTimeline,
  pageImages: Map<string, PageImageSource>,
  audioPath: string | undefined,
  outputPath: string,
  env?: string | MotionExportOptions,
): Promise<ExportResult> {
  const opts = resolveOptions(env);
  const segments = timeline.segments;
  if (segments.length === 0) {
    throw new Error('Cannot export motion comic: timeline has no segments');
  }

  const tmpDir = await mkdtemp(join(tmpdir(), 'audiocomic-motion-'));
  const segDir = join(tmpDir, 'segments');
  await mkdir(segDir, { recursive: true });

  try {
    // ── 1. Materialize input images (buffers → temp files) ──
    const inputPaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const src = pageImages.get(seg.pageId);
      if (src === undefined) {
        throw new Error(
          `Missing page image for pageId ${seg.pageId} (segment panel ${seg.panelId})`,
        );
      }
      if (typeof src === 'string') {
        inputPaths.push(src);
      } else {
        const tmp = join(tmpDir, `page-${i}.png`);
        await writeFile(tmp, src);
        inputPaths.push(tmp);
      }
    }

    // ── 2. Render each segment to its own MP4 (parallel) ──
    const segmentPaths: string[] = [];
    const tasks = segments.map((seg, i) => async () => {
      const segPath = join(segDir, `seg-${String(i).padStart(5, '0')}.mp4`);
      await renderSegment(seg, opts, inputPaths[i]!, segPath);
      return segPath;
    });

    const rendered = await runPool(tasks, opts.concurrency, opts.onProgress);
    segmentPaths.push(...rendered);

    // ── 3. Concat segments via demuxer (stream copy — no re-encode) ──
    const concatListPath = join(tmpDir, 'concat.txt');
    const concatContent = segmentPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join('\n');
    await writeFile(concatListPath, concatContent);

    const muxArgs: string[] = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
    ];

    if (audioPath) {
      muxArgs.push('-i', audioPath);
      muxArgs.push('-map', '0:v', '-map', '1:a', '-shortest');
      muxArgs.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k');
    } else {
      muxArgs.push('-map', '0:v');
      muxArgs.push('-c:v', 'copy', '-an');
    }

    muxArgs.push('-movflags', '+faststart', outputPath);

    await runBin(opts.ffmpegBin, muxArgs);

    const stats = await stat(outputPath);
    const durationSec = segments.reduce(
      (acc, s) => acc + Math.max(0, s.endSec - s.startSec),
      0,
    );

    return { path: outputPath, durationSec, sizeBytes: stats.size };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
