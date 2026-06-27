import { readFileSync } from 'node:fs';
import { experimental_transcribe as transcribe } from 'ai';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import type { TranscriptChunk } from '@audiocomic/domain';
import type { Env } from '@audiocomic/shared';
import { uuid } from '@audiocomic/shared';
import type {
  TranscriptionAdapter,
  TranscriptionOptions,
  TranscriptResult,
  TranscriptionProvider,
} from './types';

// ============================================================================
// OpenAI Whisper transcription adapter
// ============================================================================

const DEFAULT_MODEL = 'whisper-1';
/** Roughly how many words to pack into a single TranscriptChunk */
const WORDS_PER_CHUNK = 40;


type TranscriptionModel = Parameters<typeof transcribe>[0]['model'];

/**
 * Split raw transcript text into ~40-word chunks at sentence boundaries,
 * producing TranscriptChunks without timings (sufficient for story planning).
 */
function chunkPlainText(text: string, projectId: string): TranscriptChunk[] {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const chunks: TranscriptChunk[] = [];
  let bucket: string[] = [];
  let wordCount = 0;

  const flush = (index: number) => {
    if (bucket.length === 0) return;
    chunks.push({
      id: uuid(),
      projectId,
      index,
      text: bucket.join(' ').trim(),
    });
    bucket = [];
    wordCount = 0;
  };

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const wordsInSentence = trimmed.split(/\s+/).length;
    bucket.push(trimmed);
    wordCount += wordsInSentence;
    if (wordCount >= WORDS_PER_CHUNK) {
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
          ...(opts.language ? { language: opts.language } : {}),
          ...(opts.prompt ? { prompt: opts.prompt } : {}),
          ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        },
      },
      maxRetries: 3,
      abortSignal: opts.signal,
    });

    // Use the full text response directly — word-level segments are unreliable
    // across provider versions and unnecessary for story planning.
    const chunks = chunkPlainText(result.text ?? '', opts.projectId);

    return {
      chunks,
      words: [],
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
