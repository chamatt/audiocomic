import { experimental_generateSpeech as generateSpeech } from 'ai';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import type { Env } from '@audiocomic/shared';
import type { TTSAdapter, TTSOptions, TTSResult, TTSProvider } from './types';

// ============================================================================
// OpenAI TTS adapter
// ============================================================================

const DEFAULT_MODEL = 'tts-1';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_FORMAT = 'mp3';

const FORMAT_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pcm: 'audio/pcm',
};

export class OpenAITTSAdapter implements TTSAdapter {
  private readonly provider: OpenAIProvider;
  private readonly defaultVoice: string;

  constructor(env: Env, provider?: OpenAIProvider) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey && !provider) {
      throw new Error('OpenAI TTS requires OPENAI_API_KEY');
    }
    this.provider =
      provider ?? createOpenAI({ apiKey: apiKey!, compatibility: 'strict' });
    this.defaultVoice = env.DEFAULT_TTS_VOICE || DEFAULT_VOICE;
  }

  async synthesize(text: string, opts: TTSOptions = {}): Promise<TTSResult> {
    const modelId = opts.model ?? DEFAULT_MODEL;
    const voice = opts.voice ?? this.defaultVoice;
    const format = opts.format ?? DEFAULT_FORMAT;

    const result = await generateSpeech({
      model: this.provider.speech(modelId),
      text,
      voice,
      outputFormat: format,
      ...(opts.speed != null ? { speed: opts.speed } : {}),
      ...(opts.instructions ? { instructions: opts.instructions } : {}),
      maxRetries: 2,
      abortSignal: opts.signal,
    });

    const audio = result.audio;
    return {
      audio: audio.uint8Array,
      mimeType: audio.mimeType || FORMAT_MIME[format] || 'audio/mpeg',
      format: audio.format || format,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createTTSAdapter(
  provider: TTSProvider,
  env: Env,
): TTSAdapter {
  switch (provider) {
    case 'openai':
      return new OpenAITTSAdapter(env);
    default:
      throw new Error(`Unsupported TTS provider: ${provider}`);
  }
}
