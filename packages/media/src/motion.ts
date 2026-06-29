import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NarrationSegment, NarrationTimeline } from '@audiocomic/domain';

import type { ExportResult } from './types';

// ============================================================================
// Motion-comic export via FFmpeg
// ============================================================================

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
}

interface ResolvedMotion {
  ffmpegBin: string;
  width: number;
  height: number;
  fps: number;
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
    };
  }
  const o = env ?? {};
  return {
    ffmpegBin: o.ffmpegBin || (process.env.FFMPEG_BIN ?? 'ffmpeg'),
    width: o.width ?? 1280,
    height: o.height ?? 720,
    fps: o.fps ?? 24,
  };
}

/** Spawn a binary, capturing output; throw on non-zero exit. */
async function runBin(
  bin: string,
  args: string[],
  captureStderr = true,
): Promise<void> {
  const { execFile } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    execFile(bin, args, { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = captureStderr ? (stderr || '').trim() || (stdout || '').trim() : '';
        reject(new Error(`${bin} exited with code ${err.code ?? 1}\n${detail}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Build the per-segment FFmpeg filter chain that produces a labeled video
 * stream `[v{i}]` of the requested duration with the requested motion.
 *
 * zoompan is used for all non-static motions. Coordinate expressions are
 * written in the input-image space; `iw`/`ih` refer to the (scaled) input
 * dimensions and `on` is the output frame index (0..d-1).
 */
function buildSegmentChain(
  seg: NarrationSegment,
  opts: ResolvedMotion,
  frames: number,
  label: string,
): string {
  const { width: W, height: H, fps } = opts;
  const dur = Math.max(0.1, seg.endSec - seg.startSec);
  const p = seg.motionParams;
  const zoomStart = p.zoomStart;
  const zoomEnd = p.zoomEnd;
  const panX = p.panX;
  const panY = p.panY;

  // Fit the source into WxH without upscaling distortion, letterboxing black.
  const base = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}`;
  const zoompanSuffix = `:d=${frames}:s=${W}x${H}:fps=${fps}`;

  switch (seg.motion) {
    case 'static':
      return `${base},trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS[${label}]`;

    case 'zoom-in': {
      const z = `if(lte(on,0),${zoomStart},min(${zoomEnd},${zoomStart}+(${zoomEnd}-${zoomStart})*on/${frames}))`;
      const x = `iw/2-(iw/zoom/2)`;
      const y = `ih/2-(ih/zoom/2)`;
      return `${base},zoompan=z='${z}':x='${x}':y='${y}'${zoompanSuffix}[${label}]`;
    }

    case 'zoom-out': {
      const z = `if(lte(on,0),${zoomStart},max(${zoomEnd},${zoomStart}-(${zoomStart}-${zoomEnd})*on/${frames}))`;
      const x = `iw/2-(iw/zoom/2)`;
      const y = `ih/2-(ih/zoom/2)`;
      return `${base},zoompan=z='${z}':x='${x}':y='${y}'${zoompanSuffix}[${label}]`;
    }

    case 'ken-burns': {
      const z = `${zoomStart}+(${zoomEnd}-${zoomStart})*on/${frames}`;
      const x = `iw/2-(iw/zoom/2)+(${panX})*on/${frames}*iw*0.1`;
      const y = `ih/2-(ih/zoom/2)+(${panY})*on/${frames}*ih*0.1`;
      return `${base},zoompan=z='${z}':x='${x}':y='${y}'${zoompanSuffix}[${label}]`;
    }

    case 'pan-left': {
      // Camera pans left: view starts at the right edge and slides to the left.
      const z = `${zoomStart}`;
      const x = `(iw-iw/zoom)*(1-on/${frames})`;
      const y = `ih/2-(ih/zoom/2)`;
      return `${base},zoompan=z='${z}':x='${x}':y='${y}'${zoompanSuffix}[${label}]`;
    }

    case 'pan-right': {
      // Camera pans right: view starts at the left edge and slides to the right.
      const z = `${zoomStart}`;
      const x = `(iw-iw/zoom)*on/${frames}`;
      const y = `ih/2-(ih/zoom/2)`;
      return `${base},zoompan=z='${z}':x='${x}':y='${y}'${zoompanSuffix}[${label}]`;
    }

    default:
      return `${base},trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS[${label}]`;
  }
}

/**
 * Export a motion comic (MP4) from a narration timeline and per-page images.
 *
 * Each NarrationSegment becomes a video segment of duration `endSec - startSec`
 * with a Ken Burns / zoom / pan motion applied to its page image. Segments are
 * concatenated and muxed with the supplied audio track (or produced silent).
 *
 * Page images may be supplied as filesystem paths or in-memory buffers; buffers
 * are written to a temp directory for the duration of the ffmpeg invocation.
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
  const tempFiles: string[] = [];
  const inputPaths: string[] = [];

  try {
    for (const seg of segments) {
      const src = pageImages.get(seg.pageId);
      if (src === undefined) {
        throw new Error(
          `Missing page image for pageId ${seg.pageId} (segment panel ${seg.panelId})`,
        );
      }
      if (typeof src === 'string') {
        inputPaths.push(src);
      } else {
        const tmp = join(tmpDir, `page-${seg.pageId}.png`);
        await writeFile(tmp, src);
        tempFiles.push(tmp);
        inputPaths.push(tmp);
      }
    }

    const args: string[] = ['-y'];
    const filters: string[] = [];
    const concatLabels: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const dur = Math.max(0.1, seg.endSec - seg.startSec);
      const frames = Math.max(1, Math.round(dur * opts.fps));
      const imgPath = inputPaths[i]!;

      args.push('-loop', '1', '-t', dur.toFixed(3), '-i', imgPath);
      const label = `v${i}`;
      filters.push(buildSegmentChain(seg, opts, frames, label));
      concatLabels.push(`[${label}]`);
    }

    let audioInputIndex = -1;
    if (audioPath) {
      audioInputIndex = segments.length; // next input index after images
      args.push('-i', audioPath);
    }

    const concat = `${concatLabels.join('')}concat=n=${segments.length}:v=1:a=0[vout]`;
    filters.push(concat);

    args.push('-filter_complex', filters.join(';'));
    args.push('-map', '[vout]');

    if (audioInputIndex >= 0) {
      args.push('-map', `${audioInputIndex}:a`, '-shortest', '-c:a', 'aac', '-b:a', '192k');
    } else {
      // Explicit silent video: no audio stream.
      args.push('-an');
    }

    args.push(
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(opts.fps),
      '-movflags',
      '+faststart',
      outputPath,
    );

    await runBin(opts.ffmpegBin, args);

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
