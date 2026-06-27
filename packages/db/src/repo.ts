// Repository layer: CRUD for every domain entity, with Zod runtime validation.
//
// Each entity maps to a Drizzle table (src/schema.ts) and a Zod schema
// (@audiocomic/domain). Inputs are parsed through the Zod schema before
// insert/update so the database only ever stores validated domain objects.
// The `embedding` columns are DB-only (not part of the Zod schemas) and are
// therefore excluded from create/update payloads — they are written through
// dedicated vector helpers on the Repository.

import { eq, sql } from 'drizzle-orm';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm/table';
import type { ZodTypeAny } from 'zod';

import {
  CharacterProfile as CharacterProfileSchema,
  ExportBundle as ExportBundleSchema,
  JobRecord as JobRecordSchema,
  LetteringSpec as LetteringSpecSchema,
  NarrationTimeline as NarrationTimelineSchema,
  ObjectProfile as ObjectProfileSchema,
  PageComposite as PageCompositeSchema,
  PageSpec as PageSpecSchema,
  PanelRenderRequest as PanelRenderRequestSchema,
  PanelRenderResult as PanelRenderResultSchema,
  PanelSpec as PanelSpecSchema,
  Project as ProjectSchema,
  RenderPreset as RenderPresetSchema,
  SceneProfile as SceneProfileSchema,
  SourceAsset as SourceAssetSchema,
  SpeakerTurn as SpeakerTurnSchema,
  StorySection as StorySectionSchema,
  TranscriptChunk as TranscriptChunkSchema,
  WorldBible as WorldBibleSchema,
} from '@audiocomic/domain';
import type {
  CharacterProfile as CharacterProfileType,
  ExportBundle as ExportBundleType,
  JobRecord as JobRecordType,
  LetteringSpec as LetteringSpecType,
  NarrationTimeline as NarrationTimelineType,
  ObjectProfile as ObjectProfileType,
  PageComposite as PageCompositeType,
  PageSpec as PageSpecType,
  PanelRenderRequest as PanelRenderRequestType,
  PanelRenderResult as PanelRenderResultType,
  PanelSpec as PanelSpecType,
  Project as ProjectType,
  RenderPreset as RenderPresetType,
  SceneProfile as SceneProfileType,
  SourceAsset as SourceAssetType,
  SpeakerTurn as SpeakerTurnType,
  StorySection as StorySectionType,
  TranscriptChunk as TranscriptChunkType,
  WorldBible as WorldBibleType,
} from '@audiocomic/domain';

import type { Db } from './client.js';
import * as schema from './schema.js';

// ---------------------------------------------------------------------------
// Generic per-entity CRUD
// ---------------------------------------------------------------------------

/** Row shape read from the database (Drizzle inferSelect). */
type Row<TTable extends PgTableWithColumns<any>> = InferSelectModel<TTable>;
/** Payload shape accepted by drizzle `.insert()`. */
type InsertPayload<TTable extends PgTableWithColumns<any>> = InferInsertModel<TTable>;



/**
 * A domain entity bound to a Drizzle table, a Zod schema, and the projectId
 * column used for `getByProjectId` lookups.
 */
interface EntityBinding<
  TTable extends PgTableWithColumns<any>,
  TDomain,
> {
  table: TTable;
  schema: ZodTypeAny;
  /** Column object used to filter by project, or undefined for `projects`. */
  projectColumn?: PgColumn<any>;
  /** Convert a validated domain object into a Drizzle insert payload. */
  toRow: (value: TDomain) => InsertPayload<TTable>;
  /** Convert a database row back into a domain object. */
  fromRow: (row: Row<TTable>) => TDomain;
}

/** CRUD operations for a single entity. */
export interface EntityRepo<TDomain, TRow> {
  create(input: unknown): Promise<TDomain>;
  getById(id: string): Promise<TDomain | null>;
  getByProjectId(projectId: string): Promise<TDomain[]>;
  update(id: string, input: unknown): Promise<TDomain | null>;
  /** Partial update: merges a patch into the existing row, validates the result. */
  patch(id: string, patch: Partial<TDomain>): Promise<TDomain | null>;
  delete(id: string): Promise<void>;
  /** Raw row access (e.g. for vector columns not exposed by the Zod schema). */
  getRowById(id: string): Promise<TRow | null>;
}

function makeEntityRepo<
  TTable extends PgTableWithColumns<any>,
  TDomain,
>(
  db: Db,
  binding: EntityBinding<TTable, TDomain>,
): EntityRepo<TDomain, Row<TTable>> {
  const { table, schema: zodSchema, projectColumn, toRow, fromRow } = binding;

  return {
    async create(input: unknown): Promise<TDomain> {
      const parsed = zodSchema.parse(input) as TDomain;
      const [row] = await db.insert(table).values(toRow(parsed)).returning();
      return fromRow(row as Row<TTable>);
    },

    async getById(id: string): Promise<TDomain | null> {
      const rows = await db.select().from(table).where(eq(table.id, id)).limit(1);
      const row = rows[0] as Row<TTable> | undefined;
      return row ? fromRow(row) : null;
    },

    async getByProjectId(projectId: string): Promise<TDomain[]> {
      if (!projectColumn) {
        throw new Error(`Entity has no project column`);
      }
      const rows = (await db
        .select()
        .from(table)
        .where(eq(projectColumn as never, projectId))) as Row<TTable>[];
      return rows.map(fromRow);
    },

    async update(id: string, input: unknown): Promise<TDomain | null> {
      const parsed = zodSchema.parse(input) as TDomain;
      const setValues = toRow(parsed);
      const [row] = await db
        .update(table)
        .set(setValues)
        .where(eq(table.id, id))
        .returning();
      return row ? fromRow(row as Row<TTable>) : null;
    },
    async patch(id: string, patch: Partial<TDomain>): Promise<TDomain | null> {
      const existing = await this.getById(id);
      if (!existing) return null;
      const merged = { ...existing, ...patch };
      return this.update(id, merged);
    },
    async delete(id: string): Promise<void> {
      await db.delete(table).where(eq(table.id, id));
    },
    async getRowById(id: string): Promise<Row<TTable> | null> {
      const rows = await db.select().from(table).where(eq(table.id, id)).limit(1);
      return (rows[0] as Row<TTable> | undefined) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Row <-> domain conversion
// ---------------------------------------------------------------------------
//
// The Drizzle tables store every domain field. The only DB-only additions are
// the `embedding` vector columns, which are nullable and absent from the Zod
// schemas. Conversions therefore spread the row (minus embedding) into the
// domain object on read, and strip nothing on write (embedding defaults to
// null when omitted from the insert payload).

type AnyRow = Record<string, unknown>;

/** Strip DB-only columns (embedding) when materialising a domain object. */
function toDomain<T extends AnyRow>(row: T): Omit<T, 'embedding'> {
  const { embedding: _embedding, ...rest } = row;
  return rest as Omit<T, 'embedding'>;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface Repository {
  projects: EntityRepo<ProjectType, Row<typeof schema.projects>>;
  sourceAssets: EntityRepo<SourceAssetType, Row<typeof schema.sourceAssets>>;
  transcriptChunks: EntityRepo<TranscriptChunkType, Row<typeof schema.transcriptChunks>>;
  speakerTurns: EntityRepo<SpeakerTurnType, Row<typeof schema.speakerTurns>>;
  storySections: EntityRepo<StorySectionType, Row<typeof schema.storySections>>;
  characterProfiles: EntityRepo<CharacterProfileType, Row<typeof schema.characterProfiles>>;
  sceneProfiles: EntityRepo<SceneProfileType, Row<typeof schema.sceneProfiles>>;
  objectProfiles: EntityRepo<ObjectProfileType, Row<typeof schema.objectProfiles>>;
  worldBibles: EntityRepo<WorldBibleType, Row<typeof schema.worldBibles>>;
  pageSpecs: EntityRepo<PageSpecType, Row<typeof schema.pageSpecs>>;
  panelSpecs: EntityRepo<PanelSpecType, Row<typeof schema.panelSpecs>>;
  renderPresets: EntityRepo<RenderPresetType, Row<typeof schema.renderPresets>>;
  panelRenderRequests: EntityRepo<PanelRenderRequestType, Row<typeof schema.panelRenderRequests>>;
  panelRenderResults: EntityRepo<PanelRenderResultType, Row<typeof schema.panelRenderResults>>;
  pageComposites: EntityRepo<PageCompositeType, Row<typeof schema.pageComposites>>;
  letteringSpecs: EntityRepo<LetteringSpecType, Row<typeof schema.letteringSpecs>>;
  narrationTimelines: EntityRepo<NarrationTimelineType, Row<typeof schema.narrationTimelines>>;
  exportBundles: EntityRepo<ExportBundleType, Row<typeof schema.exportBundles>>;
  jobs: EntityRepo<JobRecordType, Row<typeof schema.jobs>>;

  /** Write a pgvector embedding for a row that owns an `embedding` column. */
  setEmbedding(
    table:
      | 'storySections'
      | 'characterProfiles'
      | 'sceneProfiles'
      | 'objectProfiles'
      | 'worldBibles',
    id: string,
    embedding: number[],
  ): Promise<void>;

  /** Atomically claim the next pending job (FOR UPDATE SKIP LOCKED). Returns null if none. */
  claimNextJob(): Promise<JobRecordType | null>;

  /** Get the most recent job for a project (any state). */
  getLatestJobByProject(projectId: string): Promise<JobRecordType | null>;

  /** Update a project's stage state in the stages JSONB array. */
  updateProjectStage(
    projectId: string,
    stage: string,
    state: string,
    error?: string,
  ): Promise<void>;

  /** Get/save global provider settings (single-row key-value store). */
  getSettings(): Promise<Record<string, unknown> | null>;
  saveSettings(settings: Record<string, unknown>): Promise<void>;
}

export function createRepository(db: Db): Repository {
  const projects = makeEntityRepo<typeof schema.projects, ProjectType>(db, {
    table: schema.projects,
    schema: ProjectSchema,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.projects>,
    fromRow: (r) => toDomain(r) as unknown as ProjectType,
  });

  const sourceAssets = makeEntityRepo<typeof schema.sourceAssets, SourceAssetType>(db, {
    table: schema.sourceAssets,
    schema: SourceAssetSchema,
    projectColumn: schema.sourceAssets.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.sourceAssets>,
    fromRow: (r) => toDomain(r) as unknown as SourceAssetType,
  });

  const transcriptChunks = makeEntityRepo<typeof schema.transcriptChunks, TranscriptChunkType>(db, {
    table: schema.transcriptChunks,
    schema: TranscriptChunkSchema,
    projectColumn: schema.transcriptChunks.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.transcriptChunks>,
    fromRow: (r) => toDomain(r) as unknown as TranscriptChunkType,
  });

  const speakerTurns = makeEntityRepo<typeof schema.speakerTurns, SpeakerTurnType>(db, {
    table: schema.speakerTurns,
    schema: SpeakerTurnSchema,
    projectColumn: schema.speakerTurns.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.speakerTurns>,
    fromRow: (r) => toDomain(r) as unknown as SpeakerTurnType,
  });

  const storySections = makeEntityRepo<typeof schema.storySections, StorySectionType>(db, {
    table: schema.storySections,
    schema: StorySectionSchema,
    projectColumn: schema.storySections.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.storySections>,
    fromRow: (r) => toDomain(r) as unknown as StorySectionType,
  });

  const characterProfiles = makeEntityRepo<typeof schema.characterProfiles, CharacterProfileType>(db, {
    table: schema.characterProfiles,
    schema: CharacterProfileSchema,
    projectColumn: schema.characterProfiles.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.characterProfiles>,
    fromRow: (r) => toDomain(r) as unknown as CharacterProfileType,
  });

  const sceneProfiles = makeEntityRepo<typeof schema.sceneProfiles, SceneProfileType>(db, {
    table: schema.sceneProfiles,
    schema: SceneProfileSchema,
    projectColumn: schema.sceneProfiles.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.sceneProfiles>,
    fromRow: (r) => toDomain(r) as unknown as SceneProfileType,
  });

  const objectProfiles = makeEntityRepo<typeof schema.objectProfiles, ObjectProfileType>(db, {
    table: schema.objectProfiles,
    schema: ObjectProfileSchema,
    projectColumn: schema.objectProfiles.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.objectProfiles>,
    fromRow: (r) => toDomain(r) as unknown as ObjectProfileType,
  });

  const worldBibles = makeEntityRepo<typeof schema.worldBibles, WorldBibleType>(db, {
    table: schema.worldBibles,
    schema: WorldBibleSchema,
    projectColumn: schema.worldBibles.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.worldBibles>,
    fromRow: (r) => toDomain(r) as unknown as WorldBibleType,
  });

  const pageSpecs = makeEntityRepo<typeof schema.pageSpecs, PageSpecType>(db, {
    table: schema.pageSpecs,
    schema: PageSpecSchema,
    projectColumn: schema.pageSpecs.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.pageSpecs>,
    fromRow: (r) => toDomain(r) as unknown as PageSpecType,
  });

  const panelSpecs = makeEntityRepo<typeof schema.panelSpecs, PanelSpecType>(db, {
    table: schema.panelSpecs,
    schema: PanelSpecSchema,
    projectColumn: schema.panelSpecs.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.panelSpecs>,
    fromRow: (r) => toDomain(r) as unknown as PanelSpecType,
  });

  const renderPresets = makeEntityRepo<typeof schema.renderPresets, RenderPresetType>(db, {
    table: schema.renderPresets,
    schema: RenderPresetSchema,
    projectColumn: schema.renderPresets.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.renderPresets>,
    fromRow: (r) => toDomain(r) as unknown as RenderPresetType,
  });

  const panelRenderRequests = makeEntityRepo<typeof schema.panelRenderRequests, PanelRenderRequestType>(db, {
    table: schema.panelRenderRequests,
    schema: PanelRenderRequestSchema,
    projectColumn: schema.panelRenderRequests.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.panelRenderRequests>,
    fromRow: (r) => toDomain(r) as unknown as PanelRenderRequestType,
  });

  const panelRenderResults = makeEntityRepo<typeof schema.panelRenderResults, PanelRenderResultType>(db, {
    table: schema.panelRenderResults,
    schema: PanelRenderResultSchema,
    projectColumn: schema.panelRenderResults.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.panelRenderResults>,
    fromRow: (r) => toDomain(r) as unknown as PanelRenderResultType,
  });

  const pageComposites = makeEntityRepo<typeof schema.pageComposites, PageCompositeType>(db, {
    table: schema.pageComposites,
    schema: PageCompositeSchema,
    projectColumn: schema.pageComposites.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.pageComposites>,
    fromRow: (r) => toDomain(r) as unknown as PageCompositeType,
  });

  const letteringSpecs = makeEntityRepo<typeof schema.letteringSpecs, LetteringSpecType>(db, {
    table: schema.letteringSpecs,
    schema: LetteringSpecSchema,
    projectColumn: schema.letteringSpecs.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.letteringSpecs>,
    fromRow: (r) => toDomain(r) as unknown as LetteringSpecType,
  });

  const narrationTimelines = makeEntityRepo<typeof schema.narrationTimelines, NarrationTimelineType>(db, {
    table: schema.narrationTimelines,
    schema: NarrationTimelineSchema,
    projectColumn: schema.narrationTimelines.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.narrationTimelines>,
    fromRow: (r) => toDomain(r) as unknown as NarrationTimelineType,
  });

  const exportBundles = makeEntityRepo<typeof schema.exportBundles, ExportBundleType>(db, {
    table: schema.exportBundles,
    schema: ExportBundleSchema,
    projectColumn: schema.exportBundles.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.exportBundles>,
    fromRow: (r) => toDomain(r) as unknown as ExportBundleType,
  });

  const jobs = makeEntityRepo<typeof schema.jobs, JobRecordType>(db, {
    table: schema.jobs,
    schema: JobRecordSchema,
    projectColumn: schema.jobs.projectId,
    toRow: (v) => v as unknown as InsertPayload<typeof schema.jobs>,
    fromRow: (r) => toDomain(r) as unknown as JobRecordType,
  });

  const embeddingTables = {
    storySections: schema.storySections,
    characterProfiles: schema.characterProfiles,
    sceneProfiles: schema.sceneProfiles,
    objectProfiles: schema.objectProfiles,
    worldBibles: schema.worldBibles,
  } as const;

  const setEmbedding: Repository['setEmbedding'] = async (tableName, id, embedding) => {
    const table = embeddingTables[tableName];
    await db.update(table).set({ embedding }).where(eq(table.id, id));
  };

  // --- Job queue helpers ---

  const claimNextJob: Repository['claimNextJob'] = async () => {
    // Atomically claim a pending job using FOR UPDATE SKIP LOCKED
    const result = await db.execute(sql`
      UPDATE ${schema.jobs} AS j
      SET state = 'running', "startedAt" = NOW()
      WHERE id = (
        SELECT id FROM ${schema.jobs}
        WHERE state = 'pending'
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `);
    const row = (result as unknown[])[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return toDomain(row) as unknown as JobRecordType;
  };

  const getLatestJobByProject: Repository['getLatestJobByProject'] = async (projectId) => {
    const rows = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.projectId, projectId))
      .orderBy(sql`${schema.jobs.createdAt} DESC`)
      .limit(1);
    const row = rows[0] as Row<typeof schema.jobs> | undefined;
    return row ? toDomain(row) as unknown as JobRecordType : null;
  };

  const updateProjectStage: Repository['updateProjectStage'] = async (projectId, stage, state, error) => {
    const project = await projects.getById(projectId);
    if (!project) return;
    const stages = project.stages.map((s) =>
      s.stage === stage
        ? { ...s, state: state as never, error, startedAt: state === 'running' ? new Date().toISOString() : s.startedAt, completedAt: state === 'completed' || state === 'failed' ? new Date().toISOString() : s.completedAt }
        : s,
    );
    // If the stage doesn't exist in the array, add it
    if (!stages.some((s) => s.stage === stage)) {
      stages.push({
        stage: stage as never,
        state: state as never,
        error,
        attempts: 0,
      } as never);
    }
    await projects.patch(projectId, { stages } as Partial<ProjectType>);
  };

  // --- Settings (single-row key-value store) ---

  const getSettings: Repository['getSettings'] = async () => {
    const rows = await db.select().from(schema.projects).limit(1);
    // For MVP, settings are stored in a dedicated settings row.
    // We use a simple approach: store in the first project's providerSettings.
    // In production, this would be a separate settings table.
    return null;
  };

  const saveSettings: Repository['saveSettings'] = async (_settings) => {
    // For MVP, settings are read from env defaults. This is a no-op.
    // In production, this would persist to a settings table.
  };
  return {
    projects,
    sourceAssets,
    transcriptChunks,
    speakerTurns,
    storySections,
    characterProfiles,
    sceneProfiles,
    objectProfiles,
    worldBibles,
    pageSpecs,
    panelSpecs,
    renderPresets,
    panelRenderRequests,
    panelRenderResults,
    pageComposites,
    letteringSpecs,
    narrationTimelines,
    exportBundles,
    jobs,
    setEmbedding,
    claimNextJob,
    getLatestJobByProject,
    updateProjectStage,
    getSettings,
    saveSettings,
  };
}

// Re-export the table type for consumers that need to build queries directly.
export type { PgTable } from 'drizzle-orm/pg-core';
