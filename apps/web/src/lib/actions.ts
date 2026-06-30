'use server';

import type {
  Project,
  ProviderSettings,
  JobRecord,
  PageSpec,
  PanelSpec,
  StorySection,
  CharacterProfile,
  WorldBible,
  ExportBundle,
  SourceAsset,
  PageComposite,
  PanelRenderResult,
  LetteringSpec,
  NarrationTimeline,
} from '@audiocomic/domain';
import { uuid, nowIso, defaultProviderSettings, getEnv } from '@audiocomic/shared';
import { getRepo, getSql } from '@/lib/db';
import { writeAsset } from '@/lib/storage';

// ============================================================================
// Project list + detail
// ============================================================================

export interface ProjectListItem {
  id: string;
  name: string;
  description: string | undefined;
  status: string;
  modality: string;
}

export async function listProjects(): Promise<ProjectListItem[]> {
  const repo = await getRepo();
  const sql = await getSql();
  if (!sql) return [];
  const rows = await sql`SELECT id, name, description, status, modality FROM projects ORDER BY created_at DESC`;
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? undefined,
    status: r.status as string,
    modality: r.modality as string,
  }));
}

export async function getProjectAction(id: string): Promise<Project | null> {
  const repo = await getRepo();
  return repo.projects.getById(id);
}

export interface ProjectDetailData {
  project: Project;
  job: JobRecord | null;
  pages: (PageSpec & { panels: PanelSpec[]; compositeUrl?: string })[];
  sections: StorySection[];
  characters: CharacterProfile[];
  worldBible: WorldBible | null;
  exports: ExportBundle[];
}

export async function getProjectDetail(id: string): Promise<ProjectDetailData> {
  const repo = await getRepo();

  const [project, job, sectionsRaw, characters, worldBibles, pagesRaw, exports] = await Promise.all([
    repo.projects.getById(id),
    repo.getLatestJobByProject(id),
    repo.storySections.getByProjectId(id),
    repo.characterProfiles.getByProjectId(id),
    repo.worldBibles.getByProjectId(id),
    repo.pageSpecs.getByProjectId(id),
    repo.exportBundles.getByProjectId(id),
  ]);

  if (!project) throw new Error('Project not found');
  const env = getEnv();
  const projectWithDefaults = {
    ...project,
    llmProvider: project.llmProvider ?? env.LLM_PROVIDER ?? null,
    llmModel: project.llmModel ?? env.DEFAULT_LLM_MODEL ?? null,
  };

  // Sort sections by index (within each parent level) so the storyboard
  // tree renders in narrative order, not DB insertion order.
  const sections = sectionsRaw.sort((a, b) => a.index - b.index);
  // Sort pages by chapter order, then page index within chapter.
  // Pages without a chapter go last.
  const chapters = await repo.chapters.getByProjectId(id);
  const chapterOrder = new Map(chapters.map((c, i) => [c.id, i]));
  const pages = pagesRaw.sort((a, b) => {
    const ca = a.chapterId ? (chapterOrder.get(a.chapterId) ?? Infinity) : Infinity;
    const cb = b.chapterId ? (chapterOrder.get(b.chapterId) ?? Infinity) : Infinity;
    return ca !== cb ? ca - cb : a.index - b.index;
  });

  // Load panels + composites for each page (panels sorted by index)
  const pagesWithPanels = await Promise.all(
    pages.map(async (page) => {
      const [panels, composites] = await Promise.all([
        repo.panelSpecs.getByProjectId(id).then((all) =>
          all
            .filter((p) => p.pageId === page.id)
            .sort((a, b) => a.index - b.index),
        ),
        repo.pageComposites.getByProjectId(id).then((all) =>
          all.find((c) => c.pageId === page.id),
        ),
      ]);
      return {
        ...page,
        panels,
        compositeUrl: composites?.imageKey
          ? `/api/assets/${composites.imageKey}`
          : undefined,
      };
    }),
  );

  return {
    project: projectWithDefaults,
    job,
    pages: pagesWithPanels,
    sections,
    characters,
    worldBible: worldBibles[0] ?? null,
    exports,
  };
}

// ============================================================================
// Project creation
// ============================================================================

export interface CreateProjectInput {
  name: string;
  description: string;
  modality?: 'audio' | 'text';
  fileName?: string;
  fileDataBase64?: string;
  textContent?: string;
}

export async function createProjectAction(input: CreateProjectInput): Promise<string> {
  const repo = await getRepo();
  const env = getEnv();
  const id = uuid();
  const now = nowIso();

  const project = await repo.projects.create({
    id,
    name: input.name,
    description: input.description,
    status: 'created',
    modality: input.modality ?? 'audio',
    createdAt: now,
    updatedAt: now,
    providerSettings: defaultProviderSettings(env),
    stages: [],
    llmProvider: env.LLM_PROVIDER ?? null,
    llmModel: env.DEFAULT_LLM_MODEL ?? null,
  });

  if (input.modality === 'audio' && input.fileName && input.fileDataBase64) {
    const fileData = Buffer.from(input.fileDataBase64, 'base64');
    const storageKey = `projects/${id}/source/${input.fileName}`;
    await writeAsset(storageKey, fileData);
    await repo.sourceAssets.create({
      id: uuid(),
      projectId: id,
      modality: 'audio',
      filename: input.fileName,
      mimeType: 'audio/mpeg',
      sizeBytes: fileData.length,
      storageKey,
      uploadedAt: now,
    });
  } else if (input.modality === 'text' && input.textContent) {
    const storageKey = `projects/${id}/source/text.txt`;
    await writeAsset(storageKey, Buffer.from(input.textContent, 'utf-8'));
    await repo.sourceAssets.create({
      id: uuid(),
      projectId: id,
      modality: 'text',
      filename: 'text.txt',
      mimeType: 'text/plain',
      sizeBytes: input.textContent.length,
      storageKey,
      uploadedAt: now,
    });
  }

  return id;
}

// ============================================================================
// Panel/page regeneration (delegates to job queue)
// ============================================================================

export async function regeneratePanelAction(projectId: string, panelId: string): Promise<void> {
  const repo = await getRepo();
  await repo.jobs.create({
    id: uuid(),
    projectId,
    type: 'regenerate_panel',
    state: 'pending',
    progress: 0,
    payload: { panelId },
    createdAt: nowIso(),
    attempts: 0,
  });
}

export async function regeneratePageAction(projectId: string, pageId: string): Promise<void> {
  const repo = await getRepo();
  await repo.jobs.create({
    id: uuid(),
    projectId,
    type: 'regenerate_page',
    state: 'pending',
    progress: 0,
    payload: { pageId },
    createdAt: nowIso(),
    attempts: 0,
  });
}

export async function exportProjectAction(projectId: string, type: 'pages' | 'mp4'): Promise<void> {
  const repo = await getRepo();
  await repo.jobs.create({
    id: uuid(),
    projectId,
    type: 'export',
    state: 'pending',
    progress: 0,
    payload: { exportType: type },
    createdAt: nowIso(),
    attempts: 0,
  });
}

// ============================================================================
// Settings
// ============================================================================

export async function getSettingsAction(): Promise<ProviderSettings> {
  const repo = await getRepo();
  const settings = await repo.getSettings();
  return (settings as ProviderSettings) ?? defaultProviderSettings(getEnv());
}

export async function saveSettingsAction(settings: ProviderSettings): Promise<void> {
  const repo = await getRepo();
  await repo.saveSettings(settings);
}
