import { getEnv } from "@audiocomic/shared";
import type { Env } from "@audiocomic/shared";
import type { PanelRenderRequest, PanelRenderResult } from "@audiocomic/domain";
import type { RendererAdapter } from "./types";
import { panelRenderKey, promptHash, writeLocalImage } from "./util";

const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";

/**
 * Pollinations image renderer adapter.
 *
 * Uses the simple GET-based Pollinations image API:
 *   GET https://image.pollinations.ai/prompt/{prompt}?width=&height=&seed=&model=
 *
 * The API returns image bytes directly (image/jpeg). No POST or complex auth
 * needed — the API key is passed as a query parameter for authenticated
 * requests (higher rate limits, nologo access).
 */
export class PollinationsRenderer implements RendererAdapter {
  readonly backend = "pollinations" as const;
  private readonly env: Env;
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(env: Env = getEnv()) {
    this.env = env;
    this.apiKey = env.POLLINATIONS_API_KEY;
    this.model = env.DEFAULT_IMAGE_MODEL || "flux";
  }

  async isAvailable(): Promise<boolean> {
    // Pollinations works even without an API key (rate-limited), but we
    // require the key for production use (nologo, higher limits).
    return true;
  }

  async render(req: PanelRenderRequest): Promise<PanelRenderResult> {
    const start = Date.now();

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
    // Remove watermark when authenticated
    if (this.apiKey) {
      params.set("nologo", "true");
      params.set("private", "true");
    }
    // Let the model enhance the prompt for better results
    params.set("enhance", "true");

    const url = `${POLLINATIONS_BASE}/${encodedPrompt}?${params.toString()}`;
    // Fetch the image — Pollinations returns binary image data directly.
    // Retry on 429 (rate limit) with exponential backoff.
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const MAX_RETRIES = 3;
    let response: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      response = await fetch(url, { headers });
      if (response.ok) break;
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const delayMs = 5000 * (attempt + 1); // 5s, 10s, 15s
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      const body = await response.text().catch(() => "unknown");
      throw new Error(`Pollinations render failed (${response.status}): ${body}`);
    }
    if (!response || !response.ok) {
      throw new Error("Pollinations render failed: exhausted retries");
    }

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
