import { getRepo } from "@/lib/db";
import { logger } from "@audiocomic/shared";
import type { Project } from "@audiocomic/domain";

const log = logger.scoped("api:project-patch");

// PATCH /api/projects/[id] — partial update of a project's fields.
// Currently used for renderModel selection.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as Partial<Pick<Project, "renderModel" | "renderProvider">>;
    const repo = await getRepo();
    const updated = await repo.projects.patch(id, body);
    if (!updated) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }
    return Response.json({ project: updated });
  } catch (err) {
    log.error("patch failed", { error: String(err) });
    return Response.json({ error: "Failed to update project" }, { status: 500 });
  }
}
