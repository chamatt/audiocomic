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
  private readonly defaultModel: string;

  constructor(env: Env, provider?: OpenAIProvider, defaultModel?: string) {
    // When a custom provider is supplied (e.g. Groq), OPENAI_API_KEY is not required.
    if (!env.OPENAI_API_KEY && !provider) {
      throw new Error('OpenAI transcription requires OPENAI_API_KEY');
    }
    this.provider =
      provider ??
      createOpenAI({ apiKey: env.OPENAI_API_KEY!, compatibility: 'strict' });
    this.defaultModel = defaultModel ?? DEFAULT_MODEL;
  }

  async transcribe(
    audioPath: string,
    opts: TranscriptionOptions,
  ): Promise<TranscriptResult> {
    const modelId = opts.model ?? this.defaultModel;
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

// Groq Whisper transcription adapter (direct fetch)
// ============================================================================

/**
 * Direct Groq transcription adapter. The AI SDK's OpenAI provider hardcodes
 * the multipart filename as "audio" (no extension), which Groq rejects with
 * "file must be one of the following types: [flac mp3 ...]". This adapter
 * calls the Groq API directly with a proper filename derived from the input
 * path, so the extension is preserved.
 */
export class GroqTranscriptionAdapter implements TranscriptionAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://api.groq.com/openai/v1';

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async transcribe(
    audioPath: string,
    opts: TranscriptionOptions,
  ): Promise<TranscriptResult> {
    const audio = readFileSync(audioPath);
    // Groq accepts: flac mp3 mp4 mpeg mpga m4a ogg opus wav webm
    // Remap unsupported extensions (m4b → m4a) so audiobook files work.
    const rawExt = audioPath.slice(audioPath.lastIndexOf('.') + 1).toLowerCase() || 'mp3';
    const ext = rawExt === 'm4b' ? 'm4a' : rawExt;

    const formData = new FormData();
    formData.append('model', this.model);
    formData.append('file', new File([audio], `audio.${ext}`, { type: `audio/${ext}` }));
    formData.append('response_format', 'json');
    if (opts.language) formData.append('language', opts.language);
    if (opts.prompt) formData.append('prompt', opts.prompt);
    if (opts.temperature != null) formData.append('temperature', String(opts.temperature));

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
      signal: opts.signal ?? null,
    });

    if (!response.ok) {
      const body = await response.text();
 throw new Error(`Groq transcription failed (${response.status}): ${body}`);
    }

    const result = await response.json() as { text?: string; language?: string; duration?: number };
    const chunks = chunkPlainText(result.text ?? '', opts.projectId);

    return {
      chunks,
      words: [],
      language: result.language,
      durationSec: result.duration,
    };
  }
}


export function createTranscriptionAdapter(
  provider: TranscriptionProvider,
  env: Env,
): TranscriptionAdapter {
  switch (provider) {
    case 'openai':
      return new OpenAITranscriptionAdapter(env);
    case 'groq': {
      // Groq offers a Whisper-compatible API but the AI SDK hardcodes the
      // upload filename as "audio" (no extension), which Groq rejects.
      // Use a direct fetch adapter that sends the correct filename.
      if (!env.GROQ_API_KEY) throw new Error('Groq transcription requires GROQ_API_KEY');
      return new GroqTranscriptionAdapter(env.GROQ_API_KEY, 'whisper-large-v3-turbo');
    }
    default:
      throw new Error(`Unsupported transcription provider: ${provider}`);
  }
}
