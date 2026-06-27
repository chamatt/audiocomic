import { readFileSync } from 'node:fs';
import { experimental_transcribe as transcribe } from 'ai';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import type { TranscriptChunk, WordTiming } from '@audiocomic/domain';
import type { Env } from '@audiocomic/shared';
import { uuid } from '@audiocomic/shared';
import type {
  TranscriptionAdapter,
  TranscriptionOptions,
  TranscriptResult,
  TranscriptionProvider,
} from './types.js';

// ============================================================================
// OpenAI Whisper transcription adapter
// ============================================================================

const DEFAULT_MODEL = 'whisper-1';
/** Roughly how many words to pack into a single TranscriptChunk */
const WORDS_PER_CHUNK = 40;

const SENTENCE_END = /[.!?。！？]$/;

type TranscriptionModel = Parameters<typeof transcribe>[0]['model'];

/**
 * Group flat word timings into TranscriptChunks. A chunk boundary is forced at
 * sentence terminators or when WORDS_PER_CHUNK is reached, whichever comes
 * first, so chunks stay readable and align with narration pauses.
 */
function chunkWords(words: WordTiming[], projectId: string): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let bucket: WordTiming[] = [];

  const flush = (index: number) => {
    if (bucket.length === 0) return;
    const text = bucket
      .map((w) => w.word)
      .join(' ')
      .replace(/\s+([.,;:!?])/g, '$1');
    const start = bucket[0]?.start ?? 0;
    const end = bucket[bucket.length - 1]?.end ?? start;
    const confidences = bucket
      .map((w) => w.confidence)
      .filter((c): c is number => c != null);
    const confidence =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : undefined;
    chunks.push({
      id: uuid(),
      projectId,
      index,
      text,
      start,
      end,
      words: bucket,
      confidence,
    });
    bucket = [];
  };

  for (const w of words) {
    bucket.push(w);
    if (SENTENCE_END.test(w.word) || bucket.length >= WORDS_PER_CHUNK) {
      flush(chunks.length);
    }
  }
  flush(chunks.length);
  return chunks;
}

export class OpenAITranscriptionAdapter implements TranscriptionAdapter {
  private readonly provider: OpenAIProvider;

  constructor(env: Env, provider?: OpenAIProvider) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey && !provider) {
      throw new Error('OpenAI transcription requires OPENAI_API_KEY');
    }
    this.provider =
      provider ??
      createOpenAI({ apiKey: apiKey!, compatibility: 'strict' });
  }

  async transcribe(
    audioPath: string,
    opts: TranscriptionOptions,
  ): Promise<TranscriptResult> {
    const modelId = opts.model ?? DEFAULT_MODEL;
    const model: TranscriptionModel = this.provider.transcription(modelId);

    const audio = readFileSync(audioPath);

    const result = await transcribe({
      model,
      audio,
      providerOptions: {
        openai: {
          // Request word-level timestamps; the OpenAI provider surfaces these
          // as the `segments` array on the result.
          timestampGranularities: ['word'],
          ...(opts.language ? { language: opts.language } : {}),
          ...(opts.prompt ? { prompt: opts.prompt } : {}),
          ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        },
      },
      maxRetries: 3,
      abortSignal: opts.signal,
    });

    // The OpenAI provider maps word-level results into `segments` where each
    // segment is a single word with startSecond/endSecond.
    const words: WordTiming[] = result.segments.map((seg) => ({
      word: seg.text,
      start: seg.startSecond,
      end: seg.endSecond,
    }));

    const chunks = chunkWords(words, opts.projectId);

    return {
      chunks,
      words,
      language: result.language,
      durationSec: result.durationInSeconds,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createTranscriptionAdapter(
  provider: TranscriptionProvider,
  env: Env,
): TranscriptionAdapter {
  switch (provider) {
    case 'openai':
      return new OpenAITranscriptionAdapter(env);
    default:
      throw new Error(`Unsupported transcription provider: ${provider}`);
  }
}
