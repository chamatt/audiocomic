import { getRepo } from "@/lib/db";
import { writeAsset } from "@/lib/storage";
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
    let body: { model?: string } = {};
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

    // Compute render dimensions from the panel's bbox aspect ratio.
    // bbox is normalized (0-1) relative to the page; we derive pixel
    // dimensions that match the panel's shape, capped at a base budget.
    const aspect = panel.bbox.w / panel.bbox.h;
    const BASE = 1024;
    let width: number;
    let height: number;
    if (aspect >= 1) {
      width = BASE;
      height = Math.round(BASE / aspect);
    } else {
      height = BASE;
      width = Math.round(BASE * aspect);
    }
    // Round to nearest 64 (most image models prefer multiples of 64).
    width = Math.max(64, Math.round(width / 64) * 64);
    height = Math.max(64, Math.round(height / 64) * 64);

    const renderReq: PanelRenderRequest = {
      id: uuid(),
      panelId,
      projectId: panel.projectId,
      prompt: panel.renderPrompt,
      negativePrompt: panel.renderNegativePrompt,
      model: body.model ?? (await repo.projects.getById(panel.projectId))?.renderModel,
      seed: panel.seed ?? Math.floor(Math.random() * 1_000_000_000),
      width,
      height,
      version,
      createdAt: nowIso(),
      referenceImageKeys: [],
    };

    log.info(`rendering panel ${panelId}`, { backend: getRenderer().backend, version });

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

    // The renderer's writeLocalImage already uploaded to object storage via
    // MediaManager, but if the renderer returned inline imageData, write it
    // to the web app's storage as well (covers placeholder renderer which
    // uses a different MediaManager instance).
    if ("imageData" in result && result.imageData) {
      try {
        await writeAsset(result.imageKey, Buffer.from(result.imageData as Uint8Array));
      } catch (e) {
        log.warn("failed to write image to web storage", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
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
