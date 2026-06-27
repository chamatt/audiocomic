import type { AudioProbe } from './types';

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
