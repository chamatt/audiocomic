import sharp from "sharp";
import { getRepo } from "@/lib/db";
import { writeAsset, readAsset } from "@/lib/storage";
import { logger } from "@audiocomic/shared";
import { getEnv, uuid, nowIso } from "@audiocomic/shared";
import { createRenderer } from "@audiocomic/renderers";
import type { PanelRenderRequest } from "@audiocomic/domain";

const log = logger.scoped("api:panel-regen");

// Cached renderer instance — created lazily on first render request.
let _renderer: ReturnType<typeof createRenderer> | null = null;
function getRenderer() {
  if (!_renderer) {
    const env = getEnv();
    _renderer = createRenderer(env.DEFAULT_RENDERER, env);
    log.info(`renderer initialized`, { backend: env.DEFAULT_RENDERER });
  }
  return _renderer;
}

// POST /api/panels/[id]/regenerate — render a single panel image.
// Calls the configured renderer (pollinations, comfyui, placeholder) directly,
// stores the result in DB + object storage, and patches the panel's
// renderResultId so the canvas picks up the new image on next fetch.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: panelId } = await params;
  try {
    // Optional model override from request body.
    let body: { model?: string; provider?: string } = {};
    try {
      body = await request.json();
    } catch {
      // POST with no body is fine — use default model.
    }

    const repo = await getRepo();
    const panel = await repo.panelSpecs.getById(panelId);
    if (!panel) {
      return Response.json({ error: "Panel not found" }, { status: 404 });
    }

    if (!panel.renderPrompt) {
      return Response.json(
        { error: "Panel has no render prompt — plan the chapter first" },
        { status: 400 },
      );
    }

    // Determine version: count existing render results for this panel.
    const existingResults = await repo.panelRenderResults.getByProjectId(panel.projectId);
    const version = existingResults.filter((r) => r.panelId === panelId).length;

    // Always generate at 1024×1024 (native model resolution) and crop to
    // the panel's aspect ratio afterwards. This avoids stretching because
    // models generate at their native 1:1 aspect ratio — requesting
    // non-square dimensions causes the backend to resize (stretch) the
    // output. Cropping preserves proportions and just trims edges.
    // See: https://promptingpixels.com/tutorial/width-height
    const GEN_SIZE = 1024;
    const width = GEN_SIZE;
    const height = GEN_SIZE;

    // Compute the crop aspect ratio from the panel's display dimensions.
    // bbox is normalized (0-1) relative to the page, but the page isn't
    // square (800×1131), so we must account for page dimensions.
    const PAGE_WIDTH = 800;
    const PAGE_HEIGHT = 1131;
    const panelAspect = (panel.bbox.w * PAGE_WIDTH) / (panel.bbox.h * PAGE_HEIGHT);

    const project = await repo.projects.getById(panel.projectId);
    const renderReq: PanelRenderRequest = {
      id: uuid(),
      panelId,
      projectId: panel.projectId,
      prompt: panel.renderPrompt,
      negativePrompt: panel.renderNegativePrompt,
      model: body.model ?? project?.renderModel,
      provider: body.provider ?? project?.renderProvider,
      // When a model is explicitly passed, use a random seed to bypass
      // Pollinations' prompt+seed cache (which ignores the model param).
      seed: body.model
        ? Math.floor(Math.random() * 1_000_000_000)
        : (panel.seed ?? Math.floor(Math.random() * 1_000_000_000)),
      width,
      height,
      version,
      createdAt: nowIso(),
      referenceImageKeys: [],
    };
    log.info(`rendering panel ${panelId}`, {
      backend: getRenderer().backend,
      version,
      model: renderReq.model,
      provider: renderReq.provider,
      seed: renderReq.seed,
    });

    // Persist the request (non-fatal if it fails).
    try {
      await repo.panelRenderRequests.create(renderReq);
    } catch (e) {
      log.warn("failed to persist render request", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Call the renderer.
    const renderer = getRenderer();
    const result = await renderer.render(renderReq);

    // Persist the result.
    try {
      await repo.panelRenderResults.create(result);
    } catch (e) {
      log.warn("failed to persist render result", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Patch the panel with the new renderResultId + seed.
    try {
      await repo.panelSpecs.patch(panelId, {
        renderResultId: result.id,
        seed: result.seed ?? renderReq.seed,
      });
    } catch (e) {
      log.warn("failed to patch panel renderResultId", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Crop the square 1024×1024 image to the panel's aspect ratio.
    // This avoids the stretching that occurs when models generate at
    // non-native aspect ratios — we generate at native 1:1 and crop.
    // The renderer already wrote the square image to storage, so we
    // read it back, crop, and overwrite.
    try {
      const squareBuffer = await readAsset(result.imageKey);
      const meta = await sharp(squareBuffer).metadata();
      const sw = meta.width ?? GEN_SIZE;
      const sh = meta.height ?? GEN_SIZE;

      // Compute crop dimensions preserving the panel's aspect ratio.
      let cropW: number;
      let cropH: number;
      if (panelAspect >= 1) {
        // Wide: full width, reduce height
        cropW = sw;
        cropH = Math.round(sw / panelAspect);
      } else {
        // Tall: full height, reduce width
        cropH = sh;
        cropW = Math.round(sh * panelAspect);
      }
      // Center crop
      const left = Math.round((sw - cropW) / 2);
      const top = Math.round((sh - cropH) / 2);

      const croppedBuffer = await sharp(squareBuffer)
        .extract({ left, top, width: cropW, height: cropH })
        .jpeg({ quality: 90 })
        .toBuffer();

      // Overwrite the square image in storage with the cropped version.
      await writeAsset(result.imageKey, croppedBuffer);

      log.info(`cropped ${sw}×${sh} → ${cropW}×${cropH} (aspect ${panelAspect.toFixed(2)})`, {
        panelId,
      });
    } catch (e) {
      log.warn("failed to crop image, using square original", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const imageUrl = `/api/assets/${result.imageKey}`;
    log.info(`panel ${panelId} rendered`, {
      imageKey: result.imageKey,
      durationMs: result.durationMs,
      imageUrl,
    });

    return Response.json({
      panelId,
      renderResultId: result.id,
      imageKey: result.imageKey,
      imageUrl,
      status: "done",
    });
  } catch (err) {
    log.error("panel render failed", {
      panelId,
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json(
      { error: err instanceof Error ? err.message : "Render failed" },
      { status: 500 },
    );
  }
}
