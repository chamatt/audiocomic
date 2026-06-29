import { Buffer } from 'node:buffer';
import { experimental_generateImage as generateImage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getEnv } from '@audiocomic/shared';
import type { Env } from '@audiocomic/shared';
import type { PanelRenderRequest, PanelRenderResult, RenderPreset } from '@audiocomic/domain';
import type { RendererAdapter } from './types';
import { panelRenderKey, promptHash, writeLocalImage, readLocalImage } from './util';

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

    const promptText = req.negativePrompt
      ? `${req.prompt}\n\nAvoid: ${req.negativePrompt}`
      : req.prompt;

    // When reference images are provided, use the OpenAI image edit API
    // (/v1/images/edits) for image-to-image conditioning. The AI SDK 4.x
    // generateImage only supports text-to-image, so we call the API directly
    // with multipart form data when character face refs are available.
    let imageData: Buffer;
    if (req.referenceImageKeys.length > 0) {
      const env = getEnv();
      const refBuffers = await Promise.all(
        req.referenceImageKeys.map((key) => readLocalImage(env, key)),
      );
      // Use the first reference image as the input for the edit endpoint.
      // Additional refs could be passed as additional images in the future.
      const primaryRef = refBuffers[0]!;
      const baseURL = this.baseURL ?? 'https://api.openai.com/v1';
      const form = new FormData();
      form.append('model', this.modelId);
      form.append('prompt', promptText);
      form.append('n', '1');
      form.append('size', sizeFor(req));
      form.append('image', new Blob([new Uint8Array(primaryRef)], { type: 'image/png' }), 'reference.png');
      if (req.seed !== undefined) form.append('seed', String(req.seed));

      const response = await fetch(`${baseURL}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => 'unknown');
        throw new Error(`OpenAI image edit failed (${response.status}): ${body}`);
      }
      const json = await response.json() as { data: { b64_json?: string; url?: string }[] };
      const item = json.data[0];
      if (!item) throw new Error('OpenAI image edit returned no results');
      imageData = item.b64_json
        ? Buffer.from(item.b64_json, 'base64')
        : Buffer.from(await (await fetch(item.url!)).arrayBuffer());
    } else {
      // Text-to-image via the AI SDK.
      const result = await generateImage({
        model,
        prompt: promptText,
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
      imageData = Buffer.from(file.uint8Array);
    }

    const imageKey = panelRenderKey(req.projectId, req.panelId, req.version, 'png');
    await writeLocalImage(getEnv(), imageKey, imageData);

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
