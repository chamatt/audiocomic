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
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: panelId } = await params;
  try {
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

    // Determine version: 0 for first render, increment for re-renders.
    const version = panel.renderResultId ? 1 : 0;

    const renderReq: PanelRenderRequest = {
      id: uuid(),
      panelId,
      projectId: panel.projectId,
      prompt: panel.renderPrompt,
      negativePrompt: panel.renderNegativePrompt,
      seed: panel.seed ?? Math.floor(Math.random() * 1_000_000_000),
      width: 768,
      height: 1024,
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
