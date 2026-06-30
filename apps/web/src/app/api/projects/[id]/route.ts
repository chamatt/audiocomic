import { getRepo } from "@/lib/db";
import { logger } from "@audiocomic/shared";
import type { Project } from "@audiocomic/domain";

const log = logger.scoped("api:project-patch");

// PATCH /api/projects/[id] — partial update of a project's fields.
// Currently used for renderModel selection.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
  const body = (await request.json()) as Partial<Pick<Project, "renderModel" | "renderProvider" | "llmProvider" | "llmModel" | "artStyle">>;
    const repo = await getRepo();
    const updated = await repo.projects.patch(id, body);
    if (!updated) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }
    // Art style changed → all panel prompts need re-optimization with the new style.
    if (body.artStyle !== undefined) {
      try {
        const allPanels = await repo.panelSpecs.getByProjectId(id);
        await Promise.all(
          allPanels.map((p) => repo.panelSpecs.patch(p.id, { promptStale: true })),
        );
      } catch (e) {
        log.warn("Failed to mark panels stale after art style change", {
          projectId: id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return Response.json({ project: updated });
  } catch (err) {
    log.error("patch failed", { error: String(err) });
    return Response.json({ error: "Failed to update project" }, { status: 500 });
  }
}
