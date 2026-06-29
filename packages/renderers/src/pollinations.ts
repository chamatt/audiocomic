import { getEnv } from "@audiocomic/shared";
import type { Env } from "@audiocomic/shared";
import type { PanelRenderRequest, PanelRenderResult } from "@audiocomic/domain";
import type { RendererAdapter } from "./types";
import { panelRenderKey, promptHash, writeLocalImage } from "./util";

// Legacy free endpoint (no auth, rate-limited, 768×768 output)
const POLLINATIONS_FREE_BASE = "https://image.pollinations.ai/prompt";
// New authenticated endpoint (bills to account balance, 1024×1024 output)
const POLLINATIONS_PAID_BASE = "https://gen.pollinations.ai/image";

/**
 * Pollinations image renderer adapter.
 *
 * Two endpoints:
 *   - Paid:   https://gen.pollinations.ai/image/{prompt}  (requires API key, bills balance)
 *   - Free:   https://image.pollinations.ai/prompt/{prompt} (no auth, rate-limited, for tests)
 *
 * When POLLINATIONS_API_KEY is set, uses the paid endpoint which bills to the
 * account balance and has higher rate limits. When no key is set, falls back
 * to the free legacy endpoint (anonymous tier, ~1 req/15s).
 *
 * Both return image bytes directly (image/jpeg).
 */
export class PollinationsRenderer implements RendererAdapter {
  readonly backend = "pollinations" as const;
  private readonly env: Env;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  /** When true, uses gen.pollinations.ai (paid, bills balance). When false, uses image.pollinations.ai (free, rate-limited). */
  private readonly usePaidApi: boolean;

  constructor(env: Env = getEnv()) {
    this.env = env;
    this.apiKey = env.POLLINATIONS_API_KEY;
    this.model = env.DEFAULT_IMAGE_MODEL || "flux";
    // Use paid API when key is present, unless explicitly forced to free mode
    this.usePaidApi = Boolean(this.apiKey) && env.POLLINATIONS_USE_FREE !== "true";
  }

  async isAvailable(): Promise<boolean> {
    // Pollinations works even without an API key (rate-limited), but we
    // require the key for production use (nologo, higher limits).
    return true;
  }

  async render(req: PanelRenderRequest): Promise<PanelRenderResult> {
    const start = Date.now();

    // Per-request provider override: "pollinations-free" forces the legacy
    // free endpoint even when an API key is configured; "pollinations-paid"
    // forces the authenticated endpoint. Falls back to the constructor
    // default (usePaidApi) when not specified.
    const usePaid =
      req.provider === "pollinations-paid" ? true :
      req.provider === "pollinations-free" ? false :
      this.usePaidApi;

    // Build the prompt — Pollinations is a simple GET API with no separate
    // negative prompt param, so we append negative constraints inline.
    const fullPrompt = req.negativePrompt
      ? `${req.prompt}\n\nAvoid: ${req.negativePrompt}`
      : req.prompt;
    const encodedPrompt = encodeURIComponent(fullPrompt);
    const params = new URLSearchParams();
    params.set("width", String(req.width));
    params.set("height", String(req.height));
    params.set("model", req.model ?? this.model);
    if (req.seed !== undefined) params.set("seed", String(req.seed));
    // nologo/private only supported on the paid API
    if (usePaid) {
      params.set("nologo", "true");
      params.set("private", "true");
    }
    // enhance=true disabled — causes FLUX upstream failures on long prompts
    // and inconsistent results across models. Re-enable per-model if needed.
    // params.set("enhance", "true");

    const base = usePaid ? POLLINATIONS_PAID_BASE : POLLINATIONS_FREE_BASE;
    const url = `${base}/${encodedPrompt}?${params.toString()}`;
    // Fetch the image — Pollinations returns binary image data directly.
    // Retry on 429 (rate limit) with exponential backoff.
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const MAX_RETRIES = 3;
    let response: Response | null = null;
    let currentUrl = url;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      response = await fetch(currentUrl, { headers });
      if (response.ok) break;
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const delayMs = 5000 * (attempt + 1); // 5s, 10s, 15s
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      // On 400 from FLUX (negative dimension / tensor error), retry with
      // z-image-turbo which handles long prompts better.
      if (response.status === 400 && attempt === 0) {
        const body = await response.text().catch(() => "");
        if (body.includes("negative dimension") || body.includes("FLUX")) {
          const fallbackParams = new URLSearchParams(params);
          fallbackParams.set("model", "z-image-turbo");
          fallbackParams.delete("enhance");
          currentUrl = `${base}/${encodedPrompt}?${fallbackParams.toString()}`;
          continue;
        }
      }
      const body = await response.text().catch(() => "unknown");
      throw new Error(`Pollinations render failed (${response.status}): ${body}`);
    }
    if (!response || !response.ok) {
      throw new Error("Pollinations render failed: exhausted retries");
    }

    console.log(`[pollinations] ${usePaid ? "paid" : "free"} endpoint, model=${req.model ?? this.model}, ${req.width}×${req.height}, seed=${req.seed ?? "random"}`);
    const imageBuffer = new Uint8Array(await response.arrayBuffer());

    // Determine extension from content-type
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";

    const imageKey = panelRenderKey(req.projectId, req.panelId, req.version, ext);
    await writeLocalImage(this.env, imageKey, imageBuffer);

    return {
      id: crypto.randomUUID(),
      panelId: req.panelId,
      projectId: req.projectId,
      requestId: req.id,
      backend: "pollinations",
      imageKey,
      width: req.width,
      height: req.height,
      seed: req.seed,
      durationMs: Date.now() - start,
      modelUsed: req.model ?? this.model,
      promptHash: promptHash(req.prompt),
      createdAt: new Date().toISOString(),
      accepted: false,
    };
  }
}

export function createPollinationsRenderer(env?: Env): PollinationsRenderer {
  return new PollinationsRenderer(env);
}
