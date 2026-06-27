'use server';

import type { Project, ProjectStatus, ProviderSettings, JobRecord, PageSpec, PanelSpec, StorySection, CharacterProfile, WorldBible, ExportBundle } from '@audiocomic/domain';
import { uuid, nowIso, defaultProviderSettings, getEnv } from '@audiocomic/shared';

// These imports will resolve once the db and workflows packages are merged.
// The actions layer is the bridge between the web app and the backend packages.
import { getDb, repo } from '@/lib/db';

export interface ProjectListItem {
  id: string;
  name: string;
  description: string | undefined;
  status: string;
  modality: string;
}

export async function listProjects(): Promise<ProjectListItem[]> {
  const projects = await repo.projects.list();
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    modality: p.modality,
  }));
}

export async function getProjectAction(id: string): Promise<Project | null> {
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
  const project = await repo.projects.getById(id);
  if (!project) throw new Error('Project not found');

  const [job, pages, sections, characters, worldBibles, exports] = await Promise.all([
    repo.jobs.getLatestByProject(id),
    repo.pages.getByProject(id),
    repo.sections.getByProject(id),
    repo.characters.getByProject(id),
    repo.worldBibles.getByProject(id),
    repo.exports.getByProject(id),
  ]);

  const worldBible = worldBibles[0] ?? null;

  // Fetch panels for each page and composite URL
  const pagesWithPanels = await Promise.all(
    pages.map(async (page) => {
      const panels = await repo.panels.getByPage(page.id);
      const composite = page.compositeId
        ? await repo.composites.getById(page.compositeId)
        : null;
      return {
        ...page,
        panels: panels.sort((a, b) => a.index - b.index),
        compositeUrl: composite ? `/api/assets/${composite.imageKey}` : undefined,
      };
    }),
  );

  return {
    project,
    job,
    pages: pagesWithPanels.sort((a, b) => a.index - b.index),
    sections,
    characters,
    worldBible,
    exports,
  };
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  modality: 'audio' | 'text';
  file?: File | null;
  text?: string;
}

export async function createProjectAction(input: CreateProjectInput): Promise<string> {
  const projectId = uuid();
  const now = nowIso();
  const env = getEnv();

  // Store the source asset
  let storageKey = '';
  if (input.modality === 'audio' && input.file) {
    storageKey = `projects/${projectId}/source/${input.file.name}`;
    await repo.assets.create({
      id: uuid(),
      projectId,
      modality: 'audio',
      filename: input.file.name,
      mimeType: input.file.type,
      sizeBytes: input.file.size,
      storageKey,
      uploadedAt: now,
    });
    // Write file to storage (local for MVP)
    const buffer = await input.file.arrayBuffer();
    const { writeAsset } = await import('@/lib/storage');
    await writeAsset(storageKey, Buffer.from(buffer));
  } else if (input.modality === 'text' && input.text) {
    const filename = 'book.txt';
    storageKey = `projects/${projectId}/source/${filename}`;
    await repo.assets.create({
      id: uuid(),
      projectId,
      modality: 'text',
      filename,
      mimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(input.text),
      storageKey,
      uploadedAt: now,
    });
    const { writeAsset } = await import('@/lib/storage');
    await writeAsset(storageKey, Buffer.from(input.text));
  }

  // Create the project
  const project: Project = {
    id: projectId,
    name: input.name,
    description: input.description,
    status: 'created',
    modality: input.modality,
    createdAt: now,
    updatedAt: now,
    providerSettings: defaultProviderSettings(env),
    stages: [],
  };
  await repo.projects.create(project);

  // Enqueue the pipeline job
  const { enqueueJob } = await import('@/lib/jobs');
  await enqueueJob({
    id: uuid(),
    projectId,
    type: 'full_pipeline',
    state: 'pending',
    progress: 0,
    payload: { modality: input.modality, storageKey },
    createdAt: now,
    attempts: 0,
  });

  return projectId;
}

export async function regeneratePanelAction(projectId: string, panelId: string): Promise<void> {
  const { enqueueJob } = await import('@/lib/jobs');
  await enqueueJob({
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
  const { enqueueJob } = await import('@/lib/jobs');
  await enqueueJob({
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
  const { enqueueJob } = await import('@/lib/jobs');
  await enqueueJob({
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

export async function getSettingsAction(): Promise<ProviderSettings> {
  // For MVP, settings are stored in a single-row table or env defaults
  const env = getEnv();
  return defaultProviderSettings(env);
}

export async function saveSettingsAction(settings: ProviderSettings): Promise<void> {
  // For MVP, we persist to a settings table; the worker reads from there
  await repo.settings.save(settings);
}
