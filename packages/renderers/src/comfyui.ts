import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { getEnv } from '@audiocomic/shared';
import type { Env } from '@audiocomic/shared';
import type { PanelRenderRequest, PanelRenderResult, RenderPreset } from '@audiocomic/domain';
import type { RendererAdapter } from './types';
import { panelRenderKey, promptHash, writeLocalImage } from './util';

// ============================================================================
// ComfyUI API response shapes (validated at the boundary with Zod)
// ============================================================================

const ComfyUIPromptResponse = z.object({
  prompt_id: z.string(),
  number: z.number().optional(),
  node_errors: z.record(z.string(), z.unknown()).optional(),
});

type ComfyUIPromptResponse = z.infer<typeof ComfyUIPromptResponse>;

const ComfyUIHistoryEntry = z.object({
  status: z
    .object({
      completed: z.boolean().optional(),
      status_str: z.string().optional(),
      messages: z.array(z.unknown()).optional(),
    })
    .passthrough()
    .optional(),
  outputs: z
    .record(
      z.string(),
      z.object({
        images: z
          .array(
            z.object({
              filename: z.string(),
              subfolder: z.string().optional(),
              type: z.string().optional(),
            }),
          )
          .optional(),
        gifs: z.array(z.unknown()).optional(),
      }),
    )
    .optional(),
});

type ComfyUIHistoryEntry = z.infer<typeof ComfyUIHistoryEntry>;

// ============================================================================
// Workflow construction
// ============================================================================

interface KSamplerParams {
  seed: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

/**
 * Build a minimal ComfyUI API-format workflow graph: load checkpoint,
 * CLIP text encode (positive + negative), KSampler, VAE decode, save image.
 * The graph uses string node IDs so callers can merge additional nodes
 * (ControlNet/IP-Adapter) without renumbering.
 */
function buildWorkflow(
  req: PanelRenderRequest,
  preset: RenderPreset,
  params: KSamplerParams,
): Record<string, unknown> {
  const positive = [req.prompt, preset.negativePrompt ? '' : ''].join(' ').trim();
  const negative = req.negativePrompt ?? preset.negativePrompt ?? '';
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: params.seed,
        steps: params.steps,
        cfg: params.cfg,
        sampler_name: params.sampler,
        scheduler: params.scheduler,
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: preset.model },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: req.width, height: req.height, batch_size: 1 },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: positive, clip: ['4', 1] },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative, clip: ['4', 1] },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['4', 2] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['8', 0], filename_prefix: `panel_${req.panelId}` },
    },
  };
}

function resolveSampler(preset: RenderPreset): KSamplerParams {
  return {
    seed: 0, // overwritten per-request
    steps: preset.steps,
    cfg: preset.cfgScale,
    sampler: preset.sampler ?? 'euler',
    scheduler: preset.scheduler ?? 'normal',
  };
}

// ============================================================================
// HTTP helpers
// ============================================================================

async function comfyFetch(baseUrl: string, path: string, init?: RequestInit): Promise<Response> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ComfyUI ${path} failed: ${res.status} ${res.statusText} ${body}`);
  }
  return res;
}

interface HistoryResult {
  completed: boolean;
  image: { filename: string; subfolder: string; type: string } | null;
}

/**
 * Parse a history entry into a completion flag and the first output image, if
 * any. Returns `completed: false` when the entry is absent (still queued).
 */
function inspectHistory(entry: unknown): HistoryResult {
  if (entry == null) return { completed: false, image: null };
  const parsed = ComfyUIHistoryEntry.safeParse(entry);
  if (!parsed.success) return { completed: false, image: null };
  const outputs = parsed.data.outputs ?? {};
  for (const node of Object.values(outputs)) {
    const first = node.images?.[0];
    if (first) {
      return {
        completed: true,
        image: { filename: first.filename, subfolder: first.subfolder ?? '', type: first.type ?? 'output' },
      };
    }
  }
  const completed = parsed.data.status?.completed ?? false;
  return { completed, image: null };
}

// ============================================================================
// Adapter
// ============================================================================

export interface ComfyUIRendererOptions {
  baseUrl?: string;
  apiKey?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Renderer adapter that drives a ComfyUI HTTP API. Submits an API-format
 * workflow to `/prompt`, polls `/history/{prompt_id}` until the run completes,
 * then fetches the output PNG from `/view` and persists it.
 */
export class ComfyUIRenderer implements RendererAdapter {
  readonly backend = 'comfyui' as const;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(opts: ComfyUIRendererOptions = {}) {
    const env = getEnv();
    this.baseUrl = opts.baseUrl ?? env.COMFYUI_URL ?? 'http://127.0.0.1:8188';
    this.apiKey = opts.apiKey ?? env.COMFYUI_API_KEY;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 300_000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await comfyFetch(this.baseUrl, '/system_stats', this.authHeaders());
      return res.ok;
    } catch {
      return false;
    }
  }

  async render(req: PanelRenderRequest): Promise<PanelRenderResult> {
    const start = Date.now();
    const preset = req.preset ?? this.defaultPreset(req);
    const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);
    const params = { ...resolveSampler(preset), seed };
    const workflow = buildWorkflow(req, preset, params);

    const promptId = await this.submit(workflow);
    const image = await this.awaitCompletion(promptId);
    const png = await this.fetchImage(image);
    const imageKey = panelRenderKey(req.projectId, req.panelId, req.version, 'png');
    await writeLocalImage(getEnv(), imageKey, png);

    return {
      id: crypto.randomUUID(),
      panelId: req.panelId,
      projectId: req.projectId,
      requestId: req.id,
      backend: 'comfyui',
      imageKey,
      width: req.width,
      height: req.height,
      seed,
      durationMs: Date.now() - start,
      modelUsed: preset.model,
      promptHash: promptHash(req.prompt),
      createdAt: new Date().toISOString(),
      accepted: false,
    };
  }

  private defaultPreset(req: PanelRenderRequest): RenderPreset {
    return {
      id: req.presetId ?? crypto.randomUUID(),
      name: 'comfyui-default',
      backend: 'comfyui',
      model: getEnv().DEFAULT_IMAGE_MODEL,
      loraSet: [],
      ipAdapterRefs: [],
      controlNetControls: [],
      aspectRatio: '3:4',
      qualityTier: 'standard',
      steps: 30,
      cfgScale: 7,
      sampler: 'euler',
      scheduler: 'normal',
    };
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  private async submit(workflow: Record<string, unknown>): Promise<string> {
    const res = await comfyFetch(this.baseUrl, '/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ prompt: workflow }),
    });
    const parsed = ComfyUIPromptResponse.parse(await res.json());
    return parsed.prompt_id;
  }

  private async awaitCompletion(
    promptId: string,
  ): Promise<{ filename: string; subfolder: string; type: string }> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const res = await comfyFetch(this.baseUrl, `/history/${promptId}`, this.authHeaders());
      const json = (await res.json()) as Record<string, unknown>;
      const entry = json[promptId];
      const result = inspectHistory(entry);
      if (result.completed && result.image) return result.image;
      if (result.completed && !result.image) {
        throw new Error(`ComfyUI prompt ${promptId} completed without an output image`);
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error(`ComfyUI prompt ${promptId} timed out after ${this.timeoutMs}ms`);
  }

  private async fetchImage(
    image: { filename: string; subfolder: string; type: string },
  ): Promise<Buffer> {
    const params = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder,
      type: image.type,
    });
    const res = await comfyFetch(this.baseUrl, `/view?${params.toString()}`, this.authHeaders());
    return Buffer.from(await res.arrayBuffer());
  }

  private sleep(ms: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  }
}

export function createComfyUIRenderer(env?: Env, opts?: ComfyUIRendererOptions): ComfyUIRenderer {
  if (env) {
    // Allow callers to inject an env without mutating the global singleton.
    return new ComfyUIRenderer({
      baseUrl: env.COMFYUI_URL,
      apiKey: env.COMFYUI_API_KEY,
      ...opts,
    });
  }
  return new ComfyUIRenderer(opts);
}
