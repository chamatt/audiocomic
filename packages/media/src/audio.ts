import type { AudioProbe, EmbeddedChapter } from './types';

// ============================================================================
// ffprobe JSON helpers
// ============================================================================

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string | number;
  channels?: number;
  bit_rate?: string | number;
  duration?: string | number;
}

interface FfprobeFormat {
  format_name?: string;
  bit_rate?: string | number;
  duration?: string | number;
  streams?: FfprobeStream[];
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

/** Spawn a binary, capture stdout, and throw on non-zero exit with stderr. */
async function runCapture(bin: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([bin, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${bin} exited with code ${exitCode}\n${stderr.trim() || stdout.trim()}`,
    );
  }
  return stdout;
}

function toNumber(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Probe an audio file with ffprobe.
 *
 * Uses FFPROBE_BIN from the supplied env (falls back to the process env via
 * @audiocomic/shared when not provided). Returns duration, format, bitrate,
 * sample rate, channels, and codec.
 */
export async function probeAudio(
  path: string,
  ffprobeBin: string = process.env.FFPROBE_BIN ?? 'ffprobe',
): Promise<AudioProbe> {
  const raw = await runCapture(ffprobeBin, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    path,
  ]);

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(raw) as FfprobeOutput;
  } catch (err) {
    throw new Error(`ffprobe returned non-JSON output: ${(err as Error).message}`);
  }

  const streams = parsed.streams ?? parsed.format?.streams ?? [];
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  const fmt = parsed.format ?? {};

  const duration =
    toNumber(fmt.duration) || toNumber(audioStream?.duration) || 0;
  const bitrate =
    toNumber(fmt.bit_rate) || toNumber(audioStream?.bit_rate) || 0;
  const sampleRate = toNumber(audioStream?.sample_rate) || 0;
  const channels = audioStream?.channels ?? 0;
  const codec = audioStream?.codec_name ?? 'unknown';
  const format = fmt.format_name ?? 'unknown';

  return { duration, format, bitrate, sampleRate, channels, codec };
}

/** Convenience: return just the duration in seconds. */
export async function extractAudioDuration(
  path: string,
  ffprobeBin?: string,
): Promise<number> {
  const probe = await probeAudio(path, ffprobeBin);
  return probe.duration;
}

// ============================================================================
// Embedded chapter detection and splitting (m4b audiobooks)
// ============================================================================


interface FfprobeChapter {
  start: number;
  end: number;
  tags?: { title?: string };
}

/**
 * Probe an audio file for embedded chapter markers (e.g. m4b audiobooks).
 * Returns an empty array if the file has no chapters.
 */
export async function probeChapters(
  path: string,
  ffprobeBin: string = process.env.FFPROBE_BIN ?? 'ffprobe',
): Promise<EmbeddedChapter[]> {
  const raw = await runCapture(ffprobeBin, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_chapters',
    path,
  ]);

  let parsed: { chapters?: FfprobeChapter[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const chapters = parsed.chapters ?? [];
  return chapters.map((ch, i): EmbeddedChapter => {
    const start = ch.start / 1_000_000;
    const end = ch.end / 1_000_000;
    return {
      id: i + 1,
      start,
      end,
      duration: end - start,
      title: ch.tags?.title ?? `Chapter ${i + 1}`,
    };
  });
}

/**
 * Split an audio file at a time range using ffmpeg stream copy (no re-encode).
 * Writes to outputPath as mp4.
 */
export async function splitAudioChapter(
  inputPath: string,
  outputPath: string,
  start: number,
  duration: number,
  ffmpegBin: string = process.env.FFMPEG_BIN ?? 'ffmpeg',
): Promise<void> {
  const proc = Bun.spawn([
    ffmpegBin,
    '-ss', start.toFixed(3),
    '-i', inputPath,
    '-t', duration.toFixed(3),
    '-c', 'copy',
    '-f', 'mp4',
    '-y',
    outputPath,
  ], { stdout: 'ignore', stderr: 'pipe' });

  // Drain stderr to prevent the pipe buffer from filling and blocking.
  const stderrReader = proc.stderr.getReader();
  const drainStderr = (async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done } = await stderrReader.read();
      if (done) break;
    }
  })();

  const exitCode = await proc.exited;
  await drainStderr.catch(() => {});

  if (exitCode !== 0) {
    throw new Error(`ffmpeg split failed (exit ${exitCode})`);
  }
}
