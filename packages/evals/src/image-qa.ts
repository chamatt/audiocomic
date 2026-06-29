// Image-level QA metrics — detect blank/blurry/near-monochrome panels.
//
// Uses sharp for pixel statistics (mean, stddev, entropy) to flag images
// that are likely blank, overly blurry, or lack visual detail. These are
// deterministic checks that don't require an LLM — they catch renderer
// failures (blank outputs, solid color images) cheaply.

import sharp from 'sharp';

export interface ImageQAMetrics {
  /** Mean pixel brightness (0-255). Very low or very high suggests blank. */
  mean: number;
  /** Standard deviation of pixel values. Low stddev → flat/blank image. */
  stddev: number;
  /** Shannon entropy of the histogram (0-8 bits). Low entropy → little detail. */
  entropy: number;
  /** True if the image is likely blank or near-monochrome. */
  isBlank: boolean;
  /** True if the image is likely blurry (low detail). */
  isBlurry: boolean;
  /** Overall pass/fail based on deterministic checks. */
  passed: boolean;
  /** Human-readable reason for failure, if any. */
  reason?: string;
}

/** Stddev below this suggests a flat/blank image. */
const BLANK_STDDEV_THRESHOLD = 5;
/** Entropy below this suggests very little visual detail. */
const BLANK_ENTROPY_THRESHOLD = 3;
/** Mean outside this range suggests solid black or solid white. */
const BLANK_MEAN_MIN = 5;
const BLANK_MEAN_MAX = 250;

/**
 * Evaluate image quality from a buffer using pixel statistics.
 *
 * @param imageBuffer PNG/JPEG bytes of the rendered panel
 * @returns QA metrics with pass/fail and reason
 */
export async function evaluateImageQuality(imageBuffer: Buffer): Promise<ImageQAMetrics> {
  const stats = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data } = stats;
  if (data.length === 0) {
    return {
      mean: 0,
      stddev: 0,
      entropy: 0,
      isBlank: true,
      isBlurry: true,
      passed: false,
      reason: 'Empty image buffer',
    };
  }

  // Mean
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i]!;
  const mean = sum / data.length;

  // Standard deviation
  let sqSum = 0;
  for (let i = 0; i < data.length; i++) {
    const d = data[i]! - mean;
    sqSum += d * d;
  }
  const stddev = Math.sqrt(sqSum / data.length);

  // Shannon entropy from 256-bin histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]!]!++;
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (hist[i] === 0) continue;
    const p = hist[i]! / data.length;
    entropy -= p * Math.log2(p);
  }

  const isBlank =
    stddev < BLANK_STDDEV_THRESHOLD ||
    entropy < BLANK_ENTROPY_THRESHOLD ||
    mean < BLANK_MEAN_MIN ||
    mean > BLANK_MEAN_MAX;

  const isBlurry = entropy < BLANK_ENTROPY_THRESHOLD * 1.5 && !isBlank;

  const passed = !isBlank && !isBlurry;
  let reason: string | undefined;
  if (isBlank) {
    reason = `Blank/flat image (mean=${mean.toFixed(1)}, stddev=${stddev.toFixed(1)}, entropy=${entropy.toFixed(2)})`;
  } else if (isBlurry) {
    reason = `Low detail/blurry (entropy=${entropy.toFixed(2)})`;
  }

  return { mean, stddev, entropy, isBlank, isBlurry, passed, reason };
}
