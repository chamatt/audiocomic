import { experimental_generateImage as generateImage } from 'ai';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import type { Env } from '@audiocomic/shared';
import type { ImageAdapter, ImageOptions, ImageResult, ImageProvider } from './types';

// ============================================================================
// AI SDK image generation adapter (OpenAI gpt-image-1 / dall-e-3)
// ============================================================================

const DEFAULT_MODEL = 'gpt-image-1';
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

export class AISDKImageAdapter implements ImageAdapter {
  private readonly provider: OpenAIProvider;
  private readonly defaultModel: string;

  constructor(env: Env, provider?: OpenAIProvider) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey && !provider) {
      throw new Error('AI SDK image generation requires OPENAI_API_KEY');
    }
    this.provider =
      provider ?? createOpenAI({ apiKey: apiKey!, compatibility: 'strict' });
    this.defaultModel = env.DEFAULT_IMAGE_MODEL || DEFAULT_MODEL;
  }

  async generateImage(prompt: string, opts: ImageOptions = {}): Promise<ImageResult> {
    const modelId = opts.model ?? this.defaultModel;
    const width = opts.width ?? DEFAULT_WIDTH;
    const height = opts.height ?? DEFAULT_HEIGHT;
    const size = `${width}x${height}` as `${number}x${number}`;

    type ProviderOptions = NonNullable<Parameters<typeof generateImage>[0]['providerOptions']>;
    const providerOptions: ProviderOptions = {
      ...((opts.providerOptions ?? {}) as ProviderOptions),
    };
    if (opts.negativePrompt) {
      // OpenAI image models don't honour a dedicated negative-prompt field, but
      // we forward it under openai.negativePrompt for compatible backends and
      // also append it to the prompt so the constraint actually takes effect.
      providerOptions.openai = {
        ...(providerOptions.openai ?? {}),
        negativePrompt: opts.negativePrompt,
      };
    }

    const effectivePrompt = opts.negativePrompt
      ? `${prompt}\n\nAvoid: ${opts.negativePrompt}`
      : prompt;

    const result = await generateImage({
      model: this.provider.image(modelId),
      prompt: effectivePrompt,
      ...(opts.n != null ? { n: opts.n } : {}),
      ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio as `${number}:${number}` } : {}),
      ...(opts.seed != null ? { seed: opts.seed } : {}),
      providerOptions,
      maxRetries: 2,
      abortSignal: opts.signal,
    });

    const image = result.image;
    return {
      image: image.uint8Array,
      mimeType: image.mimeType,
      width,
      height,
      ...(opts.seed != null ? { seed: opts.seed } : {}),
      model: modelId,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createImageAdapter(
  provider: ImageProvider,
  env: Env,
): ImageAdapter {
  switch (provider) {
    case 'openai':
      return new AISDKImageAdapter(env);
    default:
      throw new Error(`Unsupported image provider: ${provider}`);
  }
}
