// Bridge layer: connects the web app to @audiocomic/db.
//
// The repository is initialized eagerly on server boot. Callers use `getRepo()`
// which returns the initialized repository or throws if init failed.

import { config } from 'dotenv';
// Load .env from monorepo root, overriding any pre-existing shell env vars
// Next.js does not override existing process.env vars, so we do it explicitly
config({ path: '../../.env', override: true });

import { getEnv } from '@audiocomic/shared';
import { createDb, createRepository } from '@audiocomic/db';

import type { Project, SourceAsset, TranscriptChunk, SpeakerTurn, StorySection, CharacterProfile, SceneProfile, ObjectProfile, WorldBible, PageSpec, PanelSpec, RenderPreset, PanelRenderRequest, PanelRenderResult, PageComposite, LetteringSpec, NarrationTimeline, ExportBundle, JobRecord, ProviderSettings } from '@audiocomic/domain';

/** Convert snake_case keys to camelCase for raw SQL results. */
function snakeToCamel<T>(row: T): T {
  if (typeof row !== 'object' || row === null) return row;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (value === null) {
      out[camelKey] = undefined;
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
      out[camelKey] = value.replace(' ', 'T').replace(/\+00$/, 'Z');
    } else {
      out[camelKey] = value;
    }
  }
  return out as unknown as T;
}

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
let _initPromise: Promise<Repository> | null = null;

async function ensureRepo(): Promise<Repository> {
  if (_repo) return _repo;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const env = getEnv();
    const dbResult = createDb(env.DATABASE_URL);
    _db = dbResult;
    const raw = createRepository(dbResult.db);

    // Map the db package's entity names and methods to the web app's interface.
    // The db package uses sourceAssets/pageSpecs/panelSpecs and getByProjectId;
    // the web app expects assets/pages/panels and getByProject.
    const map = <T extends { getByProjectId?: (id: string) => Promise<unknown[]> }>(
      entity: T,
    ): T & { getByProject: (id: string) => Promise<unknown[]> } => ({
      ...entity,
      getByProject: entity.getByProjectId ?? (() => Promise.resolve([])),
    });

    // projects entity needs a `list` method (not in db package)
    const projectsEntity = raw.projects as unknown as {
      getById: (id: string) => Promise<Project | null>;
      create: (input: unknown) => Promise<unknown>;
      update: (id: string, input: unknown) => Promise<unknown>;
      patch: (id: string, patch: Partial<Project>) => Promise<Project | null>;
    };

    _repo = {
      projects: {
        list: async () => {
          const result = await dbResult.sql`SELECT * FROM projects ORDER BY created_at DESC`;
          return (result as unknown[]).map(snakeToCamel) as unknown as Project[];
        },
        getById: projectsEntity.getById,
        create: projectsEntity.create as (p: Project) => Promise<void>,
        update: (id: string, patch: Partial<Project>) =>
          projectsEntity.patch(id, patch).then(() => undefined),
      },
      assets: map(raw.sourceAssets as unknown as { getByProjectId: (id: string) => Promise<SourceAsset[]>; create: (a: SourceAsset) => Promise<void> }) as unknown as Repository['assets'],
      transcripts: map(raw.transcriptChunks as unknown as { getByProjectId: (id: string) => Promise<TranscriptChunk[]>; create: (c: TranscriptChunk) => Promise<void>; createMany: (cs: TranscriptChunk[]) => Promise<void> }) as unknown as Repository['transcripts'],
      speakers: map(raw.speakerTurns as unknown as { getByProjectId: (id: string) => Promise<SpeakerTurn[]>; create: (s: SpeakerTurn) => Promise<void> }) as unknown as Repository['speakers'],
      sections: map(raw.storySections as unknown as { getByProjectId: (id: string) => Promise<StorySection[]>; create: (s: StorySection) => Promise<void>; createMany: (ss: StorySection[]) => Promise<void> }) as unknown as Repository['sections'],
      characters: map(raw.characterProfiles as unknown as { getByProjectId: (id: string) => Promise<CharacterProfile[]>; getById: (id: string) => Promise<CharacterProfile | null>; create: (c: CharacterProfile) => Promise<void>; update: (id: string, patch: Partial<CharacterProfile>) => Promise<void> }) as unknown as Repository['characters'],
      scenes: map(raw.sceneProfiles as unknown as { getByProjectId: (id: string) => Promise<SceneProfile[]>; create: (s: SceneProfile) => Promise<void> }) as unknown as Repository['scenes'],
      objects: map(raw.objectProfiles as unknown as { getByProjectId: (id: string) => Promise<ObjectProfile[]>; create: (o: ObjectProfile) => Promise<void> }) as unknown as Repository['objects'],
      panels: {
        ...map(raw.panelSpecs as unknown as { getByProjectId: (id: string) => Promise<PanelSpec[]>; getById: (id: string) => Promise<PanelSpec | null>; create: (p: PanelSpec) => Promise<void>; update: (id: string, patch: Partial<PanelSpec>) => Promise<void> }),
        getByPage: async (pageId: string) => {
          const rows = await dbResult.sql`SELECT * FROM panel_specs WHERE page_id = ${pageId} ORDER BY index ASC`;
          return (rows as unknown[]).map(snakeToCamel) as unknown as PanelSpec[];
        },
      } as unknown as Repository['panels'],
      presets: map(raw.renderPresets as unknown as { getByProjectId: (id: string) => Promise<RenderPreset[]>; create: (p: RenderPreset) => Promise<void> }) as unknown as Repository['presets'],
      renderRequests: raw.panelRenderRequests as unknown as Repository['renderRequests'],
      renderResults: raw.panelRenderResults as unknown as Repository['renderResults'],
      composites: map(raw.pageComposites as unknown as { getByProjectId: (id: string) => Promise<PageComposite[]>; getById: (id: string) => Promise<PageComposite | null>; create: (c: PageComposite) => Promise<void> }) as unknown as Repository['composites'],
        getByPage: async (pageId: string) => {
          const rows = await dbResult.sql`SELECT * FROM lettering_specs WHERE page_id = ${pageId}`;
          return (rows as unknown[]).map(snakeToCamel) as unknown as LetteringSpec[];
        },
      } as unknown as Repository['lettering'],
      timelines: map(raw.narrationTimelines as unknown as { getByProjectId: (id: string) => Promise<NarrationTimeline[]>; create: (t: NarrationTimeline) => Promise<void> }) as unknown as Repository['timelines'],
      exports: map(raw.exportBundles as unknown as { getByProjectId: (id: string) => Promise<ExportBundle[]>; getById: (id: string) => Promise<ExportBundle | null>; create: (e: ExportBundle) => Promise<void> }) as unknown as Repository['exports'],
      jobs: {
        getLatestByProject: raw.getLatestJobByProject as (id: string) => Promise<JobRecord | null>,
        getByProject: (raw.jobs as unknown as { getByProjectId: (id: string) => Promise<JobRecord[]> }).getByProjectId,
        create: (raw.jobs as unknown as { create: (j: JobRecord) => Promise<void> }).create,
        update: (id: string, patch: Partial<JobRecord>) =>
          (raw.jobs as unknown as { patch: (id: string, patch: Partial<JobRecord>) => Promise<unknown> }).patch(id, patch).then(() => undefined),
      },
      settings: {
        get: raw.getSettings as () => Promise<ProviderSettings | null>,
        save: raw.saveSettings as (s: ProviderSettings) => Promise<void>,
      },
    } as unknown as Repository;

    return _repo;
  })();

  try {
    return await _initPromise;
  } catch (err) {
    _initPromise = null; // allow retry on next call
    throw err;
  }
}

/**
 * Get the initialized repository. Throws if the DB is not available.
 * Callers should `await getRepo()` before accessing repo methods.
 */
export async function getRepo(): Promise<Repository> {
  return ensureRepo();
}

export async function getDb(): Promise<DbInstance> {
  if (!_db) await ensureRepo();
  return _db;
}

// Initialize eagerly on server boot
if (typeof window === 'undefined') {
  ensureRepo().catch((err) => {
    console.error('[db] Failed to initialize database:', err);
  });
}

