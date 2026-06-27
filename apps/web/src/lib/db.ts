// Bridge layer: connects the web app to @audiocomic/db.
// The db package exports createDb() and a repository factory.
// We initialize lazily so the app can boot even without a live DB connection
// (e.g. during `next dev` before migrations are run).

import { getEnv } from '@audiocomic/shared';

import type { Project, SourceAsset, TranscriptChunk, SpeakerTurn, StorySection, CharacterProfile, SceneProfile, ObjectProfile, WorldBible, PageSpec, PanelSpec, RenderPreset, PanelRenderRequest, PanelRenderResult, PageComposite, LetteringSpec, NarrationTimeline, ExportBundle, JobRecord, ProviderSettings } from '@audiocomic/domain';

type DbInstance = unknown;

interface Repository {
  projects: {
    list(): Promise<Project[]>;
    getById(id: string): Promise<Project | null>;
    create(p: Project): Promise<void>;
    update(id: string, patch: Partial<Project>): Promise<void>;
  };
  assets: {
    getByProject(projectId: string): Promise<SourceAsset[]>;
    create(a: SourceAsset): Promise<void>;
  };
  transcripts: {
    getByProject(projectId: string): Promise<TranscriptChunk[]>;
    create(c: TranscriptChunk): Promise<void>;
    createMany(cs: TranscriptChunk[]): Promise<void>;
  };
  speakers: {
    getByProject(projectId: string): Promise<SpeakerTurn[]>;
    create(s: SpeakerTurn): Promise<void>;
  };
  sections: {
    getByProject(projectId: string): Promise<StorySection[]>;
    create(s: StorySection): Promise<void>;
    createMany(ss: StorySection[]): Promise<void>;
  };
  characters: {
    getByProject(projectId: string): Promise<CharacterProfile[]>;
    getById(id: string): Promise<CharacterProfile | null>;
    create(c: CharacterProfile): Promise<void>;
    update(id: string, patch: Partial<CharacterProfile>): Promise<void>;
  };
  scenes: {
    getByProject(projectId: string): Promise<SceneProfile[]>;
    create(s: SceneProfile): Promise<void>;
  };
  objects: {
    getByProject(projectId: string): Promise<ObjectProfile[]>;
    create(o: ObjectProfile): Promise<void>;
  };
  worldBibles: {
    getByProject(projectId: string): Promise<WorldBible[]>;
    create(w: WorldBible): Promise<void>;
  };
  pages: {
    getByProject(projectId: string): Promise<PageSpec[]>;
    getById(id: string): Promise<PageSpec | null>;
    create(p: PageSpec): Promise<void>;
    update(id: string, patch: Partial<PageSpec>): Promise<void>;
  };
  panels: {
    getByPage(pageId: string): Promise<PanelSpec[]>;
    getByProject(projectId: string): Promise<PanelSpec[]>;
    getById(id: string): Promise<PanelSpec | null>;
    create(p: PanelSpec): Promise<void>;
    update(id: string, patch: Partial<PanelSpec>): Promise<void>;
  };
  presets: {
    getByProject(projectId: string): Promise<RenderPreset[]>;
    create(p: RenderPreset): Promise<void>;
  };
  renderRequests: {
    create(r: PanelRenderRequest): Promise<void>;
    getByPanel(panelId: string): Promise<PanelRenderRequest[]>;
  };
  renderResults: {
    create(r: PanelRenderResult): Promise<void>;
    getByPanel(panelId: string): Promise<PanelRenderResult[]>;
  };
  composites: {
    getById(id: string): Promise<PageComposite | null>;
    getByProject(projectId: string): Promise<PageComposite[]>;
    create(c: PageComposite): Promise<void>;
  };
  lettering: {
    getByPage(pageId: string): Promise<LetteringSpec[]>;
    create(l: LetteringSpec): Promise<void>;
  };
  timelines: {
    getByProject(projectId: string): Promise<NarrationTimeline[]>;
    create(t: NarrationTimeline): Promise<void>;
  };
  exports: {
    getByProject(projectId: string): Promise<ExportBundle[]>;
    getById(id: string): Promise<ExportBundle | null>;
    create(e: ExportBundle): Promise<void>;
  };
  jobs: {
    getLatestByProject(projectId: string): Promise<JobRecord | null>;
    getByProject(projectId: string): Promise<JobRecord[]>;
    create(j: JobRecord): Promise<void>;
    update(id: string, patch: Partial<JobRecord>): Promise<void>;
  };
  settings: {
    get(): Promise<ProviderSettings | null>;
    save(s: ProviderSettings): Promise<void>;
  };
}

let _db: DbInstance | null = null;
let _repo: Repository | null = null;

async function ensureRepo(): Promise<Repository> {
  if (_repo) return _repo;
  const env = getEnv();
  const { createDb, createRepository } = await import('@audiocomic/db');
  _db = createDb(env.DATABASE_URL);
  _repo = createRepository(_db) as unknown as Repository; // db package returns its own type; we bridge to our interface
  return _repo;
}

// Eager proxy that throws a helpful error if called before DB is ready
function throwNotReady(method: string): never {
  throw new Error(
    `Repository.${method} called before DB initialization. Ensure DATABASE_URL is set and migrations are run.`,
  );
}

const unreadyRepo: Repository = {
  projects: {
    list: () => throwNotReady('projects.list'),
    getById: () => throwNotReady('projects.getById'),
    create: () => throwNotReady('projects.create'),
    update: () => throwNotReady('projects.update'),
  },
  assets: { getByProject: () => throwNotReady('assets.getByProject'), create: () => throwNotReady('assets.create') },
  transcripts: { getByProject: () => throwNotReady('transcripts.getByProject'), create: () => throwNotReady('transcripts.create'), createMany: () => throwNotReady('transcripts.createMany') },
  speakers: { getByProject: () => throwNotReady('speakers.getByProject'), create: () => throwNotReady('speakers.create') },
  sections: { getByProject: () => throwNotReady('sections.getByProject'), create: () => throwNotReady('sections.create'), createMany: () => throwNotReady('sections.createMany') },
  characters: { getByProject: () => throwNotReady('characters.getByProject'), getById: () => throwNotReady('characters.getById'), create: () => throwNotReady('characters.create'), update: () => throwNotReady('characters.update') },
  scenes: { getByProject: () => throwNotReady('scenes.getByProject'), create: () => throwNotReady('scenes.create') },
  objects: { getByProject: () => throwNotReady('objects.getByProject'), create: () => throwNotReady('objects.create') },
  worldBibles: { getByProject: () => throwNotReady('worldBibles.getByProject'), create: () => throwNotReady('worldBibles.create') },
  pages: { getByProject: () => throwNotReady('pages.getByProject'), getById: () => throwNotReady('pages.getById'), create: () => throwNotReady('pages.create'), update: () => throwNotReady('pages.update') },
  panels: { getByPage: () => throwNotReady('panels.getByPage'), getByProject: () => throwNotReady('panels.getByProject'), getById: () => throwNotReady('panels.getById'), create: () => throwNotReady('panels.create'), update: () => throwNotReady('panels.update') },
  presets: { getByProject: () => throwNotReady('presets.getByProject'), create: () => throwNotReady('presets.create') },
  renderRequests: { create: () => throwNotReady('renderRequests.create'), getByPanel: () => throwNotReady('renderRequests.getByPanel') },
  renderResults: { create: () => throwNotReady('renderResults.create'), getByPanel: () => throwNotReady('renderResults.getByPanel') },
  composites: { getById: () => throwNotReady('composites.getById'), getByProject: () => throwNotReady('composites.getByProject'), create: () => throwNotReady('composites.create') },
  lettering: { getByPage: () => throwNotReady('lettering.getByPage'), create: () => throwNotReady('lettering.create') },
  timelines: { getByProject: () => throwNotReady('timelines.getByProject'), create: () => throwNotReady('timelines.create') },
  exports: { getByProject: () => throwNotReady('exports.getByProject'), getById: () => throwNotReady('exports.getById'), create: () => throwNotReady('exports.create') },
  jobs: { getLatestByProject: () => throwNotReady('jobs.getLatestByProject'), getByProject: () => throwNotReady('jobs.getByProject'), create: () => throwNotReady('jobs.create'), update: () => throwNotReady('jobs.update') },
  settings: { get: () => throwNotReady('settings.get'), save: () => throwNotReady('settings.save') },
};

// We use a proxy that lazily resolves to the real repo, falling back to unready
const repoProxy = new Proxy(unreadyRepo, {
  get(_target, prop: string) {
    // Repository is a known interface; the proxy needs indexed access to dispatch
    const repoRecord = _repo as unknown as Record<string, unknown> | null;
    const fallbackRecord = unreadyRepo as unknown as Record<string, unknown>;
    if (repoRecord && prop in repoRecord) {
      return repoRecord[prop];
    }
    return fallbackRecord[prop];
  },
});

export const repo: Repository = repoProxy;

export async function getDb(): Promise<DbInstance> {
  if (!_db) await ensureRepo();
  return _db;
}

// Initialize eagerly on server boot
if (typeof window === 'undefined') {
  ensureRepo().catch(() => {
    // DB not ready — the proxy will throw helpful errors on access
  });
}
