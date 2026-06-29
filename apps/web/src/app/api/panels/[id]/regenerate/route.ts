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

    // Always generate at 1024×1024 (native model resolution).
    // Models generate at their native 1:1 aspect ratio — requesting
    // non-square dimensions causes the backend to resize (stretch).
    // We keep the square image as-is; the canvas uses object-cover to
    // fill the panel bbox, and the slideshow export uses square slides.
    const GEN_SIZE = 1024;
    const width = GEN_SIZE;
    const height = GEN_SIZE;

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

    // NOTE: We keep the native 1024×1024 square image — no cropping.
    // Square images work for the slideshow export, and the canvas uses
    // object-cover so the image fills the panel bbox without letterboxing.
    // The aspect ratio is handled visually by CSS, not by cropping the file.

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
