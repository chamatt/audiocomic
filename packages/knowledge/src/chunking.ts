// Transcript chunking for RAG ingestion.
//
// Concatenates the per-segment transcript chunks for a chapter into
// approximately `targetTokens`-sized segments with `overlap` tokens of
// overlap between adjacent segments. Tokens are estimated at ~4 chars/token
// (a cheap, model-agnostic heuristic). Timing metadata is preserved by
// tracking the first/last source chunk that contributed to each segment.

import type { Chunk } from './types';

/** Default target segment size in (estimated) tokens. */
const DEFAULT_TARGET_TOKENS = 512;
/** Default overlap between adjacent segments in (estimated) tokens. */
const DEFAULT_OVERLAP = 50;
/** Chars-per-token estimate. */
const CHARS_PER_TOKEN = 4;

/** Input shape — a subset of the domain TranscriptChunk. */
interface TranscriptInput {
  text: string;
  start?: number;
  end?: number;
  speaker?: string;
}

/**
 * Chunk a chapter's transcript segments into RAG-sized segments.
 *
 * Strategy:
 *  1. Concatenate all input chunk texts (joined with a space) into one
 *     transcript string, keeping a parallel array of boundary markers that
 *     map each character offset back to its source chunk.
 *  2. Walk the transcript in `targetTokens - overlap` sized steps (in chars),
 *     emitting a segment for each window. The final segment is clamped to the
 *     end of the transcript.
 *  3. For each segment, derive `startSec`/`endSec`/`speaker` from the first
 *     and last source chunks that overlap the window.
 *
 * Returns one {@link Chunk} per segment, with `chunkIndex` assigned in order
 * and `chapterId` propagated from the argument.
 */
export function chunkTranscription(
  chunks: TranscriptInput[],
  chapterId: string,
  options?: { targetTokens?: number; overlap?: number },
): Chunk[] {
  if (chunks.length === 0) return [];

  const targetTokens = options?.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const overlap = options?.overlap ?? DEFAULT_OVERLAP;

  if (targetTokens <= 0) {
    throw new Error(`chunkTranscription: targetTokens must be positive (got ${targetTokens})`);
  }
  if (overlap < 0 || overlap >= targetTokens) {
    throw new Error(
      `chunkTranscription: overlap must be in [0, targetTokens) (got ${overlap}, target=${targetTokens})`,
    );
  }

  const targetChars = targetTokens * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;
  const stepChars = Math.max(1, targetChars - overlapChars);

  // Build the concatenated transcript and a parallel array recording which
  // source chunk each character came from.
  let transcript = '';
  /** `charToChunk[i]` = index into `chunks` for the character at offset i. */
  const charToChunk: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i]!.text;
    if (i > 0) {
      transcript += ' ';
      charToChunk.push(i); // attribute the separator to the upcoming chunk
    }
    for (let j = 0; j < text.length; j++) {
      transcript += text[j];
      charToChunk.push(i);
    }
  }

  if (transcript.length === 0) return [];

  const segments: Chunk[] = [];
  let segIndex = 0;
  let start = 0;

  while (start < transcript.length) {
    let end = start + targetChars;
    if (end > transcript.length) end = transcript.length;

    const text = transcript.slice(start, end).trim();
    if (text.length > 0) {
      const firstSrc = charToChunk[start] ?? 0;
      const lastSrc = charToChunk[Math.min(end - 1, transcript.length - 1)] ?? chunks.length - 1;
      const firstChunk = chunks[firstSrc]!;
      const lastChunk = chunks[lastSrc]!;

      segments.push({
        text,
        metadata: {
          chapterId,
          chunkIndex: segIndex,
          startSec: firstChunk.start,
          endSec: lastChunk.end,
          // Speaker is only meaningful when the whole segment came from one
          // speaker; otherwise omit it rather than pick arbitrarily.
          speaker: firstSrc === lastSrc ? firstChunk.speaker : undefined,
        },
      });
      segIndex++;
    }

    // Final segment — stop to avoid an infinite loop when stepChars is small.
    if (end >= transcript.length) break;
    start += stepChars;
  }

  return segments;
}
