import { Buffer } from 'node:buffer';
import { experimental_generateImage as generateImage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getEnv } from '@audiocomic/shared';
import type { Env } from '@audiocomic/shared';
import type { PanelRenderRequest, PanelRenderResult, RenderPreset } from '@audiocomic/domain';
import type { RendererAdapter } from './types';
import { panelRenderKey, promptHash, writeLocalImage } from './util';

/**
 * Map a {@link RenderPreset.qualityTier} to the OpenAI image `quality`
 * provider option. Falls back to `'auto'` for unknown tiers.
 */
function qualityFor(tier: RenderPreset['qualityTier']): 'auto' | 'low' | 'medium' | 'high' {
  switch (tier) {
    case 'draft':
      return 'low';
    case 'high':
      return 'high';
    case 'standard':
    default:
      return 'medium';
  }
}

/**
 * Map a {@link RenderPreset.aspectRatio} to the OpenAI image `size` option.
 * OpenAI supports a fixed set of sizes; unknown ratios fall back to 1024x1024.
 */
function sizeFor(req: PanelRenderRequest): `${number}x${number}` {
  const { width, height } = req;
  const sizes: Array<`${number}x${number}`> = ['1024x1024', '1024x1536', '1536x1024'];
  for (const s of sizes) {
    const [w, h] = s.split('x').map(Number) as [number, number];
    if (w === width && h === height) return s;
  }
  // Pick the closest standard size by area.
  const target = width * height;
  let best: `${number}x${number}` = '1024x1024';
  let bestDelta = Infinity;
  for (const s of sizes) {
    const [w, h] = s.split('x').map(Number) as [number, number];
    const delta = Math.abs(w * h - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = s;
    }
  }
  return best;
}

export interface AISDKImageRendererOptions {
  apiKey?: string;
  baseURL?: string;
  modelId?: string;
}

/**
 * Renderer adapter backed by the Vercel AI SDK `generateImage` call, using the
 * OpenAI image provider (DALL-E / gpt-image). Requires `OPENAI_API_KEY` in the
 * environment. The generated image is persisted to local storage and mapped to
 * a {@link PanelRenderResult}.
 */
export class AISDKImageRenderer implements RendererAdapter {
  readonly backend = 'aisdk' as const;
  private readonly apiKey?: string;
  private readonly baseURL?: string;
  private readonly modelId: string;

  constructor(opts: AISDKImageRendererOptions = {}) {
    const env = getEnv();
    this.apiKey = opts.apiKey ?? env.OPENAI_API_KEY;
    this.baseURL = opts.baseURL;
    this.modelId = opts.modelId ?? 'gpt-image-1';
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async render(req: PanelRenderRequest): Promise<PanelRenderResult> {
    if (!this.apiKey) {
      throw new Error('AISDKImageRenderer requires OPENAI_API_KEY');
    }
    const start = Date.now();
    const preset = req.preset ?? this.defaultPreset(req);
    const provider = createOpenAI({ apiKey: this.apiKey, baseURL: this.baseURL });
    const model = provider.image(this.modelId);

    const prompt = req.negativePrompt
      ? `${req.prompt}\n\nAvoid: ${req.negativePrompt}`
      : req.prompt;

    const result = await generateImage({
      model,
      prompt,
      size: sizeFor(req),
      aspectRatio: preset.aspectRatio,
      seed: req.seed,
      n: 1,
      providerOptions: {
        openai: { quality: qualityFor(preset.qualityTier) },
      },
    });

    const file = result.images[0];
    if (!file) throw new Error('AI SDK image generation returned no images');
    const data = Buffer.from(file.uint8Array);
    const imageKey = panelRenderKey(req.projectId, req.panelId, req.version, 'png');
    await writeLocalImage(getEnv(), imageKey, data);

    return {
      id: crypto.randomUUID(),
      panelId: req.panelId,
      projectId: req.projectId,
      requestId: req.id,
      backend: 'aisdk',
      imageKey,
      width: req.width,
      height: req.height,
      seed: req.seed,
      durationMs: Date.now() - start,
      modelUsed: this.modelId,
      promptHash: promptHash(req.prompt),
      createdAt: new Date().toISOString(),
      accepted: false,
    };
  }

  private defaultPreset(req: PanelRenderRequest): RenderPreset {
    return {
      id: req.presetId ?? crypto.randomUUID(),
      name: 'aisdk-default',
      backend: 'aisdk',
      model: this.modelId,
      loraSet: [],
      ipAdapterRefs: [],
      controlNetControls: [],
      aspectRatio: '3:4',
      qualityTier: 'standard',
      steps: 30,
      cfgScale: 7,
    };
  }
}

export function createAISDKImageRenderer(env?: Env, opts?: AISDKImageRendererOptions): AISDKImageRenderer {
  if (env) {
    return new AISDKImageRenderer({
      apiKey: env.OPENAI_API_KEY,
      ...opts,
    });
  }
  return new AISDKImageRenderer(opts);
}
