import type {
  JobRecord,
  Project,
  StageState,
  StorySection,
  CharacterProfile,
  WorldBible,
  PageSpec,
  PanelSpec,
  PanelRenderRequest,
  PanelRenderResult,
  NarrationTimeline,
  ExportBundle,
  SourceAsset,
  TranscriptChunk,
  SpeakerTurn,
  SceneProfile,
  ObjectProfile,
  LetteringSpec,
  PageComposite,
  RenderPreset,
} from '@audiocomic/domain';
import {
  validatePageLayout,
  validatePanelSectionRefs,
  ProjectStage,
} from '@audiocomic/domain';
import { uuid, nowIso, getEnv, panelImageKey, pageImageKey, letteringKey, exportKey } from '@audiocomic/shared';
import type { JobHandler, JobResult, JobContext } from './engine';
import { STAGE_ORDER, computeProgress } from './stages';

// ============================================================================
// Pipeline dependencies — injected, not imported directly
// ============================================================================

export interface PipelineDeps {
  // Storage
  readAsset(key: string): Promise<Buffer>;
  writeAsset(key: string, data: Buffer): Promise<void>;
  assetExists(key: string): Promise<boolean>;

  // Repository (database access)
  repo: PipelineRepo;

  // AI adapters
  transcribe(audioPath: string): Promise<{ chunks: TranscriptChunk[]; durationSec: number }>;
  diarize?(audioPath: string, chunks: TranscriptChunk[]): Promise<SpeakerTurn[]>;
  planStory(input: StoryPlanInput): Promise<StoryPlanOutput>;
  synthesizeTTS?(text: string, opts?: { voice?: string }): Promise<{ audio: Uint8Array; durationSec?: number }>;
  composePrompt(input: PromptComposeInput): Promise<string>;

  // Renderer
  renderPanel(req: PanelRenderRequest): Promise<PanelRenderResult>;

  // Media
  parseTextBook(content: string): Promise<ParsedBook>;
  probeAudio(path: string): Promise<{ durationSec: number }>;
  composePage(panelImages: Buffer[], pageSpec: PageSpec, panelSpecs: PanelSpec[], size: { width: number; height: number }): Promise<Buffer>;
  renderLettering(spec: LetteringSpec, pageWidth: number, pageHeight: number): Promise<string>;
  exportMotionComic(timeline: NarrationTimeline, pageImages: Map<string, string>, audioPath: string | undefined, outputPath: string): Promise<{ sizeBytes: number; durationSec: number }>;
  exportPageBundle(pageImages: string[], outputPath: string): Promise<{ sizeBytes: number }>;
}

export interface PipelineRepo {
  getProject(id: string): Promise<Project | null>;
  updateProject(id: string, patch: Partial<Project>): Promise<void>;
  getAssetsByProject(projectId: string): Promise<SourceAsset[]>;
  createTranscriptChunks(chunks: TranscriptChunk[]): Promise<void>;
  getTranscriptChunks(projectId: string): Promise<TranscriptChunk[]>;
  createSpeakerTurns(turns: SpeakerTurn[]): Promise<void>;
  createStorySections(sections: StorySection[]): Promise<void>;
  getStorySections(projectId: string): Promise<StorySection[]>;
  createCharacters(chars: CharacterProfile[]): Promise<void>;
  getCharacters(projectId: string): Promise<CharacterProfile[]>;
  createScenes(scenes: SceneProfile[]): Promise<void>;
  createObjects(objects: ObjectProfile[]): Promise<void>;
  createWorldBible(bible: WorldBible): Promise<void>;
  getWorldBible(projectId: string): Promise<WorldBible | null>;
  createPages(pages: PageSpec[]): Promise<void>;
  getPages(projectId: string): Promise<PageSpec[]>;
  updatePage(id: string, patch: Partial<PageSpec>): Promise<void>;
  createPanels(panels: PanelSpec[]): Promise<void>;
  getPanelsByPage(pageId: string): Promise<PanelSpec[]>;
  getPanelsByProject(projectId: string): Promise<PanelSpec[]>;
  updatePanel(id: string, patch: Partial<PanelSpec>): Promise<void>;
  createRenderRequest(req: PanelRenderRequest): Promise<void>;
  createRenderResult(result: PanelRenderResult): Promise<void>;
  getRenderResultsByPanel(panelId: string): Promise<PanelRenderResult[]>;
  createComposite(composite: PageComposite): Promise<void>;
  getCompositesByProject(projectId: string): Promise<PageComposite[]>;
  createLettering(spec: LetteringSpec): Promise<void>;
  createTimeline(timeline: NarrationTimeline): Promise<void>;
  getTimeline(projectId: string): Promise<NarrationTimeline | null>;
  createExport(bundle: ExportBundle): Promise<void>;
  getRenderPreset(id: string): Promise<RenderPreset | null>;
  claimNextJob(): Promise<JobRecord | null>;
  updateJob(id: string, patch: Partial<JobRecord>): Promise<void>;
  updateProjectStage(projectId: string, stage: ProjectStage, state: StageState, error?: string): Promise<void>;
}

export interface StoryPlanInput {
  projectId: string;
  text: string;
  modality: 'audio' | 'text';
  chunkTimings?: { start: number; end: number; text: string }[];
}

export interface StoryPlanOutput {
  sections: StorySection[];
  characters: CharacterProfile[];
  scenes: SceneProfile[];
  objects: ObjectProfile[];
  worldBible: WorldBible;
}

export interface PromptComposeInput {
  panel: PanelSpec;
  section: StorySection;
  characters: CharacterProfile[];
  worldBible: WorldBible;
  sectionMemory?: string;
}

export interface ParsedBook {
  chapters: { title: string; text: string; wordStart: number; wordEnd: number }[];
}

// ============================================================================
// Full pipeline handler
// ============================================================================

export class FullPipelineHandler implements JobHandler {
  readonly jobType = 'full_pipeline' as const;

  constructor(private readonly deps: PipelineDeps) {}

  async execute(job: JobRecord, ctx: JobContext): Promise<JobResult> {
    const project = await this.deps.repo.getProject(ctx.projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const payload = job.payload as { modality: string; storageKey: string };
    const completed: ProjectStage[] = [];

    try {
      // Stage 1: Normalize
      await ctx.updateStage('normalize', 'running');
      const sourceData = await this.normalize(project, payload.storageKey, ctx);
      await ctx.updateStage('normalize', 'completed');
      completed.push('normalize');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 2: Transcribe / parse text
      await ctx.updateStage('transcribe', 'running');
      const chunks = await this.transcribeOrParse(project, sourceData, ctx);
      await ctx.updateStage('transcribe', 'completed');
      completed.push('transcribe');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 3: Segment
      await ctx.updateStage('segment', 'running');
      const fullText = chunks.map((c) => c.text).join(' ');
      await ctx.updateStage('segment', 'completed');
      completed.push('segment');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 4: Plan story
      await ctx.updateStage('plan_story', 'running');
      const planInput: StoryPlanInput = {
        projectId: ctx.projectId,
        text: fullText,
        modality: project.modality,
        chunkTimings: chunks.map((c) => ({
          start: c.start ?? 0,
          end: c.end ?? 0,
          text: c.text,
        })),
      };
      const plan = await this.deps.planStory(planInput);
      await this.deps.repo.createStorySections(plan.sections);
      await this.deps.repo.createCharacters(plan.characters);
      await this.deps.repo.createScenes(plan.scenes);
      await this.deps.repo.createObjects(plan.objects);
      await this.deps.repo.createWorldBible(plan.worldBible);
      await ctx.updateStage('plan_story', 'completed');
      completed.push('plan_story');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 5: Build bibles (already done in planStory, mark complete)
      await ctx.updateStage('build_bibles', 'running');
      await ctx.updateStage('build_bibles', 'completed');
      completed.push('build_bibles');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 6: Section memory (embeddings — for MVP, we skip actual embedding generation
      // but mark the stage complete; the retrieval layer can use text matching)
      await ctx.updateStage('section_memory', 'running');
      await ctx.updateStage('section_memory', 'completed');
      completed.push('section_memory');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 7: Plan pages
      await ctx.updateStage('plan_pages', 'running');
      const { pages, panels } = await this.planPages(ctx.projectId, plan, chunks, ctx);
      await this.deps.repo.createPages(pages);
      await this.deps.repo.createPanels(panels);
      await ctx.updateStage('plan_pages', 'completed');
      completed.push('plan_pages');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 8: Validate layout
      await ctx.updateStage('validate_layout', 'running');
      const sectionIds = new Set(plan.sections.map((s) => s.id));
      for (const page of pages) {
        const pagePanels = panels.filter((p) => p.pageId === page.id);
        const layoutResult = validatePageLayout(page, pagePanels);
        const refResult = validatePanelSectionRefs(pagePanels, sectionIds);
        const issues = [...layoutResult.errors, ...refResult.errors];
        await this.deps.repo.updatePage(page.id, {
          layoutValid: issues.length === 0,
          layoutIssues: issues,
        });
        if (issues.length > 0) {
          ctx.log(`Page ${page.index} layout issues: ${issues.join('; ')}`);
        }
      }
      await ctx.updateStage('validate_layout', 'completed');
      completed.push('validate_layout');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 9: Compose prompts
      await ctx.updateStage('compose_prompts', 'running');
      const characters = await this.deps.repo.getCharacters(ctx.projectId);
      const sections = await this.deps.repo.getStorySections(ctx.projectId);
      const worldBible = await this.deps.repo.getWorldBible(ctx.projectId);
      if (!worldBible) throw new Error('World bible missing');
      const sectionMap = new Map(sections.map((s) => [s.id, s]));
      for (const panel of panels) {
        const section = sectionMap.get(panel.storySectionId);
        if (!section) continue;
        const prompt = await this.deps.composePrompt({
          panel,
          section,
          characters: characters.filter((c) => panel.characters.some((pc) => pc.characterId === c.id)),
          worldBible,
        });
        await this.deps.repo.updatePanel(panel.id, { renderPrompt: prompt });
      }
      await ctx.updateStage('compose_prompts', 'completed');
      completed.push('compose_prompts');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 10: Render panels
      await ctx.updateStage('render_panels', 'running');
      const updatedPanels = await this.deps.repo.getPanelsByProject(ctx.projectId);
      let rendered = 0;
      for (const panel of updatedPanels) {
        if (!panel.renderPrompt) continue;
        const renderReq: PanelRenderRequest = {
          id: uuid(),
          panelId: panel.id,
          projectId: ctx.projectId,
          prompt: panel.renderPrompt,
          negativePrompt: panel.renderNegativePrompt,
          seed: panel.seed ?? Math.floor(Math.random() * 1_000_000_000),
          width: 768,
          height: 1024,
          version: 0,
          createdAt: nowIso(),
          referenceImageKeys: characters
            .filter((c) => panel.characters.some((pc) => pc.characterId === c.id))
            .flatMap((c) => [c.canonicalFaceRef, c.canonicalBodyRef].filter((k): k is string => !!k)),
        };
        await this.deps.repo.createRenderRequest(renderReq);
        const result = await this.deps.renderPanel(renderReq);
        await this.deps.repo.createRenderResult(result);
        await this.deps.repo.updatePanel(panel.id, {
          renderResultId: result.id,
          seed: result.seed ?? renderReq.seed,
        });
        rendered++;
        await ctx.updateProgress(computeProgressFromList(completed) + (rendered / updatedPanels.length) * (1 / STAGE_ORDER.length));
      }
      await ctx.updateStage('render_panels', 'completed');
      completed.push('render_panels');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 11: Panel QA (for MVP, mark all as passed)
      await ctx.updateStage('panel_qa', 'running');
      const renderedPanels = await this.deps.repo.getPanelsByProject(ctx.projectId);
      for (const panel of renderedPanels) {
        if (panel.renderResultId) {
          await this.deps.repo.updatePanel(panel.id, { qaStatus: 'passed' });
        }
      }
      await ctx.updateStage('panel_qa', 'completed');
      completed.push('panel_qa');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 12: Compose pages
      await ctx.updateStage('compose_pages', 'running');
      const allPages = await this.deps.repo.getPages(ctx.projectId);
      for (const page of allPages) {
        const pagePanels = await this.deps.repo.getPanelsByPage(page.id);
        const panelImages: Buffer[] = [];
        for (const panel of pagePanels) {
          const results = await this.deps.repo.getRenderResultsByPanel(panel.id);
          const latest = results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          if (latest) {
            const img = await this.deps.readAsset(latest.imageKey);
            panelImages.push(img);
          }
        }
        if (panelImages.length > 0) {
          const composed = await this.deps.composePage(panelImages, page, pagePanels, { width: 1200, height: 1600 });
          const key = pageImageKey(ctx.projectId, page.id, 0);
          await this.deps.writeAsset(key, composed);
          const composite: PageComposite = {
            id: uuid(),
            pageId: page.id,
            projectId: ctx.projectId,
            imageKey: key,
            width: 1200,
            height: 1600,
            panelImageKeys: pagePanels.map((p) => p.id),
            createdAt: nowIso(),
            version: 0,
          };
          await this.deps.repo.createComposite(composite);
          await this.deps.repo.updatePage(page.id, { compositeId: composite.id });
        }
      }
      await ctx.updateStage('compose_pages', 'completed');
      completed.push('compose_pages');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 13: Lettering
      await ctx.updateStage('lettering', 'running');
      const compositedPages = await this.deps.repo.getPages(ctx.projectId);
      for (const page of compositedPages) {
        const pagePanels = await this.deps.repo.getPanelsByPage(page.id);
        const allDialogue = pagePanels.flatMap((p) =>
          p.dialogueLines.map((d, i) => ({
            id: uuid(),
            type: d.type as 'speech' | 'thought' | 'narration' | 'sfx' | 'caption',
            text: d.text,
            bbox: { x: 0.05, y: 0.05 + i * 0.1, w: 0.9, h: 0.08 },
            panelId: p.id,
            speaker: d.speaker,
          })),
        );
        if (allDialogue.length > 0) {
          const spec: LetteringSpec = {
            id: uuid(),
            pageId: page.id,
            projectId: ctx.projectId,
            boxes: allDialogue,
            version: 0,
            createdAt: nowIso(),
          };
          const svg = await this.deps.renderLettering(spec, 1200, 1600);
          const key = letteringKey(ctx.projectId, page.id, 0);
          await this.deps.writeAsset(key, Buffer.from(svg));
          await this.deps.repo.createLettering(spec);
        }
      }
      await ctx.updateStage('lettering', 'completed');
      completed.push('lettering');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 14: Export static
      await ctx.updateStage('export_static', 'running');
      const finalPages = await this.deps.repo.getPages(ctx.projectId);
      const composites = await this.deps.repo.getCompositesByProject(ctx.projectId);
      const pageImagePaths: string[] = [];
      for (const page of finalPages) {
        const comp = composites.find((c) => c.pageId === page.id);
        if (comp) pageImagePaths.push(comp.imageKey);
      }
      if (pageImagePaths.length > 0) {
        const exportId = uuid();
        const key = exportKey(ctx.projectId, exportId, 'zip');
        const localPath = `${getEnv().EXPORT_DIR}/${key}`;
        const result = await this.deps.exportPageBundle(pageImagePaths, localPath);
        const bundle: ExportBundle = {
          id: exportId,
          projectId: ctx.projectId,
          type: 'pages',
          storageKey: key,
          createdAt: nowIso(),
          sizeBytes: result.sizeBytes,
          metadata: {},
        };
        await this.deps.repo.createExport(bundle);
      }
      await ctx.updateStage('export_static', 'completed');
      completed.push('export_static');
      await ctx.updateProgress(computeProgressFromList(completed));

      // Stage 15: Export motion comic
      await ctx.updateStage('export_motion', 'running');
      const timeline = await this.buildTimeline(ctx.projectId, finalPages, chunks);
      if (timeline.segments.length > 0) {
        await this.deps.repo.createTimeline(timeline);
        const audioPath = project.modality === 'audio' ? payload.storageKey : undefined;
        const motionExportId = uuid();
        const motionKey = exportKey(ctx.projectId, motionExportId, 'mp4');
        const motionLocalPath = `${getEnv().EXPORT_DIR}/${motionKey}`;
        const pageImageMap = new Map<string, string>();
        for (const page of finalPages) {
          const comp = composites.find((c) => c.pageId === page.id);
          if (comp) pageImageMap.set(page.id, comp.imageKey);
        }
        const motionResult = await this.deps.exportMotionComic(timeline, pageImageMap, audioPath, motionLocalPath);
        const motionBundle: ExportBundle = {
          id: motionExportId,
          projectId: ctx.projectId,
          type: 'mp4',
          storageKey: motionKey,
          createdAt: nowIso(),
          sizeBytes: motionResult.sizeBytes,
          metadata: { durationSec: motionResult.durationSec },
        };
        await this.deps.repo.createExport(motionBundle);
      }
      await ctx.updateStage('export_motion', 'completed');
      completed.push('export_motion');

      // Mark project complete
      await this.deps.repo.updateProject(ctx.projectId, { status: 'completed', updatedAt: nowIso() });
      await ctx.updateProgress(1);

      return { success: true, completedStages: completed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log(`Pipeline failed: ${message}`);
      await this.deps.repo.updateProject(ctx.projectId, { status: 'failed', updatedAt: nowIso() });
      return { success: false, error: message, completedStages: completed };
    }
  }

  private async normalize(
    project: Project,
    storageKey: string,
    ctx: JobContext,
  ): Promise<{ audioPath?: string; textContent?: string }> {
    ctx.log(`Normalizing source: ${storageKey}`);
    if (project.modality === 'audio') {
      // For audio, we need a local file path for ffmpeg/whisper
      // In production, this would download from object storage to a temp file
      const env = getEnv();
      return { audioPath: `${env.UPLOAD_DIR}/${storageKey}` };
    } else {
      const content = await this.deps.readAsset(storageKey);
      return { textContent: content.toString('utf-8') };
    }
  }

  private async transcribeOrParse(
    project: Project,
    sourceData: { audioPath?: string; textContent?: string },
    ctx: JobContext,
  ): Promise<TranscriptChunk[]> {
    if (project.modality === 'audio' && sourceData.audioPath) {
      ctx.log('Transcribing audio...');
      const result = await this.deps.transcribe(sourceData.audioPath);
      const chunks = result.chunks.map((c, i) => ({
        ...c,
        id: uuid(),
        projectId: project.id,
        index: i,
      }));
      await this.deps.repo.createTranscriptChunks(chunks);
      return chunks;
    } else if (sourceData.textContent) {
      ctx.log('Parsing text...');
      const parsed = await this.deps.parseTextBook(sourceData.textContent);
      const chunks: TranscriptChunk[] = parsed.chapters.map((ch, i) => ({
        id: uuid(),
        projectId: project.id,
        index: i,
        text: ch.text,
      }));
      await this.deps.repo.createTranscriptChunks(chunks);
      return chunks;
    }
    throw new Error('No source data to transcribe or parse');
  }

  private async planPages(
    projectId: string,
    plan: StoryPlanOutput,
    chunks: TranscriptChunk[],
    ctx: JobContext,
  ): Promise<{ pages: PageSpec[]; panels: PanelSpec[] }> {
    ctx.log('Planning pages and panels...');
    const beats = plan.sections.filter((s) => s.level === 'beat');
    const pages: PageSpec[] = [];
    const panels: PanelSpec[] = [];

    // Group beats into pages (2-4 beats per page for MVP)
    const beatsPerPage = 3;
    for (let pageIdx = 0; pageIdx < beats.length; pageIdx += beatsPerPage) {
      const pageBeats = beats.slice(pageIdx, pageIdx + beatsPerPage);
      const pageId = uuid();
      const panelIds: string[] = [];
      const pagePanels: PanelSpec[] = [];

      for (let panelIdx = 0; panelIdx < pageBeats.length; panelIdx++) {
        const beat = pageBeats[panelIdx]!;
        const panelId = uuid();
        panelIds.push(panelId);

        // Simple grid layout: vertical stack
        const panelHeight = 1 / pageBeats.length;
        const panel: PanelSpec = {
          id: panelId,
          pageId,
          projectId,
          index: panelIdx,
          storySectionId: beat.id,
          bbox: {
            x: 0.05,
            y: 0.05 + panelIdx * panelHeight,
            w: 0.9,
            h: panelHeight * 0.95,
          },
          zIndex: panelIdx,
          description: beat.summary,
          cameraFraming: beat.cameraHint,
          characters: beat.charactersPresent.map((charId) => ({
            characterId: charId,
          })),
          dialogueLines: [],
          startSec: beat.startSec,
          endSec: beat.endSec,
          qaStatus: 'pending',
        };
        pagePanels.push(panel);
        panels.push(panel);
      }

      const page: PageSpec = {
        id: pageId,
        projectId,
        index: pages.length,
        storySectionId: pageBeats[0]!.id,
        panelIds,
        panelCount: pagePanels.length,
        readingOrder: panelIds,
        emphasisWeights: {},
        bleedGutter: { bleed: 0, gutter: 0.02 },
        layoutValid: false,
        layoutIssues: [],
      };
      pages.push(page);
    }

    return { pages, panels };
  }

  private async buildTimeline(
    projectId: string,
    pages: PageSpec[],
    chunks: TranscriptChunk[],
  ): Promise<NarrationTimeline> {
    const segments: NarrationTimeline['segments'] = [];
    let currentTime = 0;

    for (const page of pages) {
      const pagePanels = await this.deps.repo.getPanelsByPage(page.id);
      for (const panel of pagePanels) {
        const start = panel.startSec ?? currentTime;
        const end = panel.endSec ?? start + 5;
        segments.push({
          panelId: panel.id,
          pageId: page.id,
          startSec: start,
          endSec: end,
          motion: 'ken-burns',
          motionParams: {
            zoomStart: 1.0,
            zoomEnd: 1.15,
            panX: 0,
            panY: 0,
          },
          text: panel.description,
        });
        currentTime = end;
      }
    }

    return {
      id: uuid(),
      projectId,
      segments,
      totalDurationSec: currentTime,
      ttsGenerated: false,
    };
  }
}

// ============================================================================
// Regenerate panel handler
// ============================================================================

export class RegeneratePanelHandler implements JobHandler {
  readonly jobType = 'regenerate_panel' as const;

  constructor(private readonly deps: PipelineDeps) {}

  async execute(job: JobRecord, ctx: JobContext): Promise<JobResult> {
    const payload = job.payload as { panelId: string };
    const panel = (await this.deps.repo.getPanelsByProject(ctx.projectId)).find(
      (p) => p.id === payload.panelId,
    );
    if (!panel) return { success: false, error: 'Panel not found' };

    const existingResults = await this.deps.repo.getRenderResultsByPanel(panel.id);
    const nextVersion = existingResults.length;

    const renderReq: PanelRenderRequest = {
      id: uuid(),
      panelId: panel.id,
      projectId: ctx.projectId,
      prompt: panel.renderPrompt ?? panel.description,
      negativePrompt: panel.renderNegativePrompt,
      seed: panel.seed ?? Math.floor(Math.random() * 1_000_000_000),
      width: 768,
      height: 1024,
      version: nextVersion,
      createdAt: nowIso(),
      referenceImageKeys: [],
    };
    await this.deps.repo.createRenderRequest(renderReq);
    const result = await this.deps.renderPanel(renderReq);
    await this.deps.repo.createRenderResult(result);
    await this.deps.repo.updatePanel(panel.id, {
      renderResultId: result.id,
      seed: result.seed ?? renderReq.seed,
      qaStatus: 'passed',
    });

    return { success: true };
  }
}

// ============================================================================
// Regenerate page handler (re-composes page after panel changes)
// ============================================================================

export class RegeneratePageHandler implements JobHandler {
  readonly jobType = 'regenerate_page' as const;

  constructor(private readonly deps: PipelineDeps) {}

  async execute(job: JobRecord, ctx: JobContext): Promise<JobResult> {
    const payload = job.payload as { pageId: string };
    const pages = await this.deps.repo.getPages(ctx.projectId);
    const page = pages.find((p) => p.id === payload.pageId);
    if (!page) return { success: false, error: 'Page not found' };

    // Re-render all panels on this page
    const panels = await this.deps.repo.getPanelsByPage(page.id);
    for (const panel of panels) {
      const renderReq: PanelRenderRequest = {
        id: uuid(),
        panelId: panel.id,
        projectId: ctx.projectId,
        prompt: panel.renderPrompt ?? panel.description,
        negativePrompt: panel.renderNegativePrompt,
        seed: Math.floor(Math.random() * 1_000_000_000),
        width: 768,
        height: 1024,
        version: (await this.deps.repo.getRenderResultsByPanel(panel.id)).length,
        createdAt: nowIso(),
        referenceImageKeys: [],
      };
      await this.deps.repo.createRenderRequest(renderReq);
      const result = await this.deps.renderPanel(renderReq);
      await this.deps.repo.createRenderResult(result);
      await this.deps.repo.updatePanel(panel.id, { renderResultId: result.id, seed: result.seed });
    }

    // Re-compose the page
    const updatedPanels = await this.deps.repo.getPanelsByPage(page.id);
    const panelImages: Buffer[] = [];
    for (const panel of updatedPanels) {
      const results = await this.deps.repo.getRenderResultsByPanel(panel.id);
      const latest = results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (latest) {
        panelImages.push(await this.deps.readAsset(latest.imageKey));
      }
    }
    if (panelImages.length > 0) {
      const composed = await this.deps.composePage(panelImages, page, updatedPanels, { width: 1200, height: 1600 });
      const key = pageImageKey(ctx.projectId, page.id, (await this.deps.repo.getCompositesByProject(ctx.projectId)).filter((c) => c.pageId === page.id).length);
      await this.deps.writeAsset(key, composed);
      const composite: PageComposite = {
        id: uuid(),
        pageId: page.id,
        projectId: ctx.projectId,
        imageKey: key,
        width: 1200,
        height: 1600,
        panelImageKeys: updatedPanels.map((p) => p.id),
        createdAt: nowIso(),
        version: 0,
      };
      await this.deps.repo.createComposite(composite);
      await this.deps.repo.updatePage(page.id, { compositeId: composite.id });
    }

    return { success: true };
  }
}

// ============================================================================
// Export handler
// ============================================================================

export class ExportHandler implements JobHandler {
  readonly jobType = 'export' as const;

  constructor(private readonly deps: PipelineDeps) {}

  async execute(job: JobRecord, ctx: JobContext): Promise<JobResult> {
    const payload = job.payload as { exportType: 'pages' | 'mp4' };
    const pages = await this.deps.repo.getPages(ctx.projectId);
    const composites = await this.deps.repo.getCompositesByProject(ctx.projectId);

    if (payload.exportType === 'pages') {
      const pageImagePaths = pages
        .map((p) => composites.find((c) => c.pageId === p.id)?.imageKey)
        .filter((k): k is string => !!k);
      if (pageImagePaths.length === 0) return { success: false, error: 'No composed pages' };
      const exportId = uuid();
      const key = exportKey(ctx.projectId, exportId, 'zip');
      const localPath = `${getEnv().EXPORT_DIR}/${key}`;
      const result = await this.deps.exportPageBundle(pageImagePaths, localPath);
      await this.deps.repo.createExport({
        id: exportId,
        projectId: ctx.projectId,
        type: 'pages',
        storageKey: key,
        createdAt: nowIso(),
        sizeBytes: result.sizeBytes,
        metadata: {},
      });
      return { success: true };
    } else {
      const timeline = await this.deps.repo.getTimeline(ctx.projectId);
      if (!timeline) return { success: false, error: 'No narration timeline' };
      const exportId = uuid();
      const key = exportKey(ctx.projectId, exportId, 'mp4');
      const localPath = `${getEnv().EXPORT_DIR}/${key}`;
      const pageImageMap = new Map<string, string>();
      for (const page of pages) {
        const comp = composites.find((c) => c.pageId === page.id);
        if (comp) pageImageMap.set(page.id, comp.imageKey);
      }
      const result = await this.deps.exportMotionComic(timeline, pageImageMap, undefined, localPath);
      await this.deps.repo.createExport({
        id: exportId,
        projectId: ctx.projectId,
        type: 'mp4',
        storageKey: key,
        createdAt: nowIso(),
        sizeBytes: result.sizeBytes,
        metadata: { durationSec: result.durationSec },
      });
      return { success: true };
    }
  }
}

function computeProgressFromList(completed: ProjectStage[]): number {
  return completed.length / STAGE_ORDER.length;
}
