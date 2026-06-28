import { State } from "@rivetkit/effect";
import { Effect } from "effect";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Chapter, ChapterState, type StageProgress } from "./api.ts";
import type { TranscriptionOptions, TranscriptResult } from "@audiocomic/ai";
import { PipelineBridge } from "../../lib/pipeline-bridge.ts";
import { uuid, nowIso, logger, pageImageKey, letteringKey } from "@audiocomic/shared";
import { ingestChapterTranscription, createEmbeddingProvider, makeWikiIngestor } from "@audiocomic/knowledge";
import type { StorySection, PageSpec, PanelSpec, CharacterProfile, WorldBible, PageComposite, LetteringSpec, LetteringBox, PanelRenderRequest, PanelRenderResult } from "@audiocomic/domain";

const log = logger.scoped("chapter");

/**
 * Fresh, empty chapter state. The actor is keyed, so the durable `id` is
 * derived from the actor key by the caller; the initial state only needs to
 * be a valid placeholder with no asset linked and no pipeline run started.
 */
function freshState(): ChapterState {
	return {
		id: "",
		projectId: "",
		index: 0,
		title: "",
		description: undefined,
		sourceAssetId: undefined,
		status: "pending",
		stage: "pending",
		stageProgress: undefined,
		durationSec: undefined,
		transcriptionStatus: "pending",
		pipelineId: undefined,
	};
}

// --- Plan helpers (from plan_chapters step) ---

const DEFAULT_MAX_PAGES = 4;
const DEFAULT_BEATS_PER_PAGE = 3;

function isBeatSection(v: unknown): v is StorySection {
	if (typeof v !== "object" || v === null) return false;
	const r = v as Record<string, unknown>;
	return (
		r.level === "beat" &&
		typeof r.summary === "string" &&
		Array.isArray(r.charactersPresent)
	);
}

function sampleEvenly<T>(items: T[], max: number): T[] {
	if (items.length <= max) return items;
	const out: T[] = [];
	const step = items.length / max;
	for (let i = 0; i < max; i++) {
		out.push(items[Math.floor(i * step)]!);
	}
	return out;
}

function hasImageData(v: PanelRenderResult): v is PanelRenderResult & { imageData: Buffer } {
	return "imageData" in v;
}

/**
 * Live server implementation of the Chapter actor.
 *
 * State is the full {@link ChapterState} projection. Reads use
 * `State.get(state).pipe(Effect.orDie)` to collapse the schema-error channel;
 * mutations use `State.updateAndGet(state, fn).pipe(Effect.orDie)` and
 * broadcast a `chapterUpdated` event carrying the new state so subscribed
 * clients can reconcile.
 *
 * The wake function pulls {@link PipelineBridge} from the Effect context so
 * the transcription flow can reach the repository, blob storage, and the
 * transcription adapter. `StartTranscription` forks a daemon fiber that
 * downloads the linked asset, writes it to a temp file, runs the adapter,
 * persists the resulting chunks, and flips the state to `completed` (or
 * `failed` on error) — the action itself returns immediately with the
 * chapter in the `running` transcription state.
 */
export const ChapterLive = Chapter.toLayer(
	({ rawRivetkitContext, state }) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			const getState = (): Effect.Effect<ChapterState> =>
				State.get(state).pipe(Effect.orDie);

			const update = (
				fn: (current: ChapterState) => ChapterState,
			): Effect.Effect<ChapterState> =>
				State.updateAndGet(state, fn).pipe(
					Effect.orDie,
					Effect.tap((next) =>
						Effect.sync(() =>
							rawRivetkitContext.broadcast("chapterUpdated", next),
						),
					),
				);

		// Update stage + progress in actor state, DB, and broadcast.
		const setStage = (
			stage: string,
			progress?: StageProgress,
		): Effect.Effect<ChapterState> =>
			update((s) => ({ ...s, stage, stageProgress: progress })).pipe(
				Effect.tap((next) =>
					Effect.tryPromise({
						try: () =>
							bridge.repo.chapters.patch(next.id, {
								stage,
								stageProgress: progress ?? null,
							} as Partial<unknown>),
						catch: () => Promise.resolve(),
					}).pipe(Effect.ignore),
				),
			);

		/**
		 * Background ingest fiber. Embeds transcript chunks + runs wiki ingest
		 * + bible builder for this chapter only. Auto-advances to plan.
		 */
		const runIngest = (current: ChapterState): Effect.Effect<void, Error> =>
			Effect.gen(function* () {
				yield* setStage("ingesting", { current: 0, total: 3, detail: "Embedding transcript" });

				// 1. Check if already ingested — skip if so.
				const existing = yield* Effect.tryPromise({
					try: () => bridge.repo.chapterIngestLog.getByChapterId(current.id),
					catch: () => Promise.resolve(null),
				});
				if (existing) {
					log.info("chapter already ingested, skipping", { chapterId: current.id });
					yield* runPlan(current);
					return;
				}

			// 2. Embed transcript chunks (non-fatal — wiki + bible still work without vectors).
			let embeddingsCount = 0;
			const embedder = createEmbeddingProvider(bridge.env);
			yield* Effect.tryPromise({
				try: () => ingestChapterTranscription(bridge.repo, embedder, current.projectId, current.id),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			}).pipe(
				Effect.tap((r) => Effect.sync(() => { embeddingsCount = r.embeddingCount; })),
				Effect.tap(() => Effect.sync(() => log.info("embedding done", { chapterId: current.id, embeddings: embeddingsCount }))),
				Effect.catchCause((cause) =>
					Effect.gen(function* () {
						log.warn("embedding skipped (non-fatal)", { chapterId: current.id, error: cause.toString() });
						yield* setStage("ingesting", { current: 1, total: 3, detail: "Embeddings skipped — continuing with wiki" });
					}),
				),
			);

				yield* setStage("ingesting", { current: 1, total: 3, detail: "Extracting wiki entities" });

				// 3. Wiki ingest.
				const wiki = makeWikiIngestor(bridge.repo, bridge.getStoryPlanner());
				const allChunks = yield* Effect.tryPromise({
					try: () => bridge.repo.transcriptChunks.getByProjectId(current.projectId),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				const chapterText = allChunks
					.filter((c) => c.chapterId === current.id)
					.map((c) => c.text)
					.join("\\n");

				const beforePages = yield* Effect.tryPromise({
					try: () => bridge.repo.knowledgePages.getByProjectId(current.projectId),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});

				yield* Effect.tryPromise({
					try: () => wiki.ingestChapter(current.id, current.projectId, chapterText, current.index),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});

				const afterPages = yield* Effect.tryPromise({
					try: () => bridge.repo.knowledgePages.getByProjectId(current.projectId),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				const wikiPagesCreated = Math.max(0, afterPages.length - beforePages.length);

				yield* setStage("ingesting", { current: 2, total: 3, detail: "Building bible" });

				// 4. Bible builder agent (per-chapter).
				try {
					const bibleAgent = bridge.getBibleBuilderAgent(current.projectId);
					yield* Effect.tryPromise({
					try: () => bibleAgent.buildBible({ projectId: current.projectId, chapterId: current.id, chapterIndex: current.index, text: chapterText }),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					}).pipe(Effect.catchCause((c) => Effect.logWarning(`bible builder failed: ${c}`)));
				} catch { /* non-fatal */ }

				// 5. Record ingest in log.
				yield* Effect.tryPromise({
					try: () => bridge.repo.chapterIngestLog.insert({
						chapterId: current.id,
						projectId: current.projectId,
						embeddingsCount,
						wikiPagesCount: wikiPagesCreated,
					}),
					catch: () => Promise.resolve(),
				});

				yield* setStage("ingesting", { current: 3, total: 3, detail: "Done" });
			log.info("ingest complete", { chapterId: current.id, embeddings: embeddingsCount, wikiPages: wikiPagesCreated });

				// Auto-advance to plan.
				yield* runPlan(current);
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.gen(function* () {
						log.error("ingest fiber failed", { chapterId: current.id, error: cause.toString() });
						yield* setStage("failed", { current: 0, total: 0, detail: cause.toString() });
						yield* Effect.tryPromise({
							try: () => bridge.repo.chapters.patch(current.id, { status: "failed" } as Partial<unknown>),
							catch: () => Promise.resolve(),
						}).pipe(Effect.ignore);
						rawRivetkitContext.broadcast("chapterIngestFailed", { chapterId: current.id, error: cause.toString() });
					}),
				),
			);

		/**
		 * Background plan fiber. Segments transcript → plans story → plans
		 * pages → composes prompts for this chapter. Sets stage to
		 * ready_for_review after completion.
		 */
		const runPlan = (current: ChapterState): Effect.Effect<void, Error> =>
			Effect.gen(function* () {
				yield* setStage("planning", { current: 0, total: 4, detail: "Segmenting transcript" });

				// 1. Get this chapter's transcript chunks.
				const allChunks = yield* Effect.tryPromise({
					try: () => bridge.repo.transcriptChunks.getByProjectId(current.projectId),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				const chapterChunks = allChunks
					.filter((c) => c.chapterId === current.id)
					.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
				const chapterText = chapterChunks.map((c) => c.text).join("\\n\\n");

				if (chapterText.length === 0) {
					yield* setStage("failed", { current: 0, total: 0, detail: "No transcript text" });
					return;
				}

				yield* setStage("planning", { current: 1, total: 4, detail: "Planning story" });

				// 2. Plan story via Mastra agent.
				const agent = bridge.getStoryPlannerAgent(current.projectId);
				const storyResult = yield* Effect.tryPromise({
					try: () => agent.planStory({ projectId: current.projectId, text: chapterText }),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});

				const sections: StorySection[] = storyResult.sections;
				const characters: CharacterProfile[] = storyResult.characters;
				const worldBible: WorldBible = storyResult.worldBible;

				// Persist story data (non-fatal).
				yield* Effect.tryPromise({
					try: () => Promise.all([
						Promise.all(sections.map((s) => bridge.repo.storySections.create(s))),
						Promise.all(characters.map((c) => bridge.repo.characterProfiles.create(c))),
					]),
					catch: (e) => new Error(`plan: DB persist failed (non-fatal): ${e}`),
				}).pipe(Effect.catch((e: Error) => Effect.logInfo(e.message)));

				yield* setStage("planning", { current: 2, total: 4, detail: "Planning pages" });

			// 3. Plan pages: divide beats into pages/panels.
			// Prefer beat-level sections, but fall back to scene/chapter if the model didn't produce beats.
			const beats = sections.filter(isBeatSection);
			if (beats.length === 0) {
				// No beats — use all sections as beats instead of failing.
				log.warn("no beat-level sections found, using all sections", { chapterId: current.id, sectionCount: sections.length, levels: sections.map(s => s.level) });
			}
			const effectiveBeats = beats.length > 0 ? beats : sections;
			if (effectiveBeats.length === 0) {
				yield* setStage("failed", { current: 0, total: 0, detail: "No sections extracted from story plan" });
				return;
			}

			const maxBeats = DEFAULT_MAX_PAGES * DEFAULT_BEATS_PER_PAGE;
			const selected = sampleEvenly(effectiveBeats, maxBeats);

				const pages: PageSpec[] = [];
				const panels: PanelSpec[] = [];

				for (let pageIdx = 0; pageIdx < DEFAULT_MAX_PAGES; pageIdx++) {
					const pageBeats = selected.slice(pageIdx * DEFAULT_BEATS_PER_PAGE, (pageIdx + 1) * DEFAULT_BEATS_PER_PAGE);
					if (pageBeats.length === 0) break;

					const pageId = uuid();
					const panelHeight = 1 / pageBeats.length;
					const panelIds: string[] = [];

					for (let panelIdx = 0; panelIdx < pageBeats.length; panelIdx++) {
						const beat = pageBeats[panelIdx]!;
						const panelId = uuid();
						panelIds.push(panelId);

						panels.push({
							id: panelId,
							pageId,
							projectId: current.projectId,
							chapterId: current.id,
							index: panelIdx,
							storySectionId: beat.id,
							bbox: { x: 0.05, y: 0.05 + panelIdx * panelHeight, w: 0.9, h: panelHeight * 0.95 },
							zIndex: panelIdx,
							description: beat.summary,
							cameraFraming: beat.cameraHint,
							characters: beat.charactersPresent
								.map((name) => characters.find((c) => c.name.toLowerCase() === name.toLowerCase()))
								.filter((c): c is CharacterProfile => c !== undefined)
								.map((c) => ({ characterId: c.id })),
							dialogueLines: [],
							startSec: beat.startSec,
							endSec: beat.endSec,
							qaStatus: "pending",
						});
					}

					pages.push({
						id: pageId,
						projectId: current.projectId,
						chapterId: current.id,
						index: pageIdx,
						storySectionId: pageBeats[0]!.id,
						panelIds,
						panelCount: pageBeats.length,
						readingOrder: panelIds,
						emphasisWeights: {},
						bleedGutter: { bleed: 0, gutter: 0.02 },
						layoutValid: false,
						layoutIssues: [],
					});
				}

				yield* setStage("planning", { current: 3, total: 4, detail: "Composing prompts" });

				// 4. Compose prompts for each panel.
				const sectionMap = new Map<string, StorySection>(sections.map((s) => [s.id, s]));
				for (const panel of panels) {
					const section = sectionMap.get(panel.storySectionId);
					if (!section) continue;
					const panelCharacters = characters.filter((c) => panel.characters.some((pc) => pc.characterId === c.id));
					const prompt = bridge.composePanelPrompt(panel, section, panelCharacters, worldBible);
					panel.renderPrompt = prompt;
					yield* Effect.tryPromise(() => bridge.repo.panelSpecs.patch(panel.id, { renderPrompt: prompt }))
						.pipe(Effect.catch(() => Effect.sync(() => {})));
				}

				// Persist pages and panels (non-fatal).
				yield* Effect.tryPromise({
					try: () => Promise.all([
						Promise.all(pages.map((p) => bridge.repo.pageSpecs.create(p))),
						Promise.all(panels.map((p) => bridge.repo.panelSpecs.create(p))),
					]),
					catch: (e) => new Error(`plan: DB persist failed (non-fatal): ${e}`),
				}).pipe(Effect.catch((e: Error) => Effect.logInfo(e.message)));

				yield* setStage("ready_for_review", { current: pages.length, total: pages.length, detail: `${pages.length} pages, ${panels.length} panels` });
				log.info("plan complete", { chapterId: current.id, pages: pages.length, panels: panels.length });
				rawRivetkitContext.broadcast("chapterPlanned", { chapterId: current.id, pages: pages.length, panels: panels.length });
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.gen(function* () {
						log.error("plan fiber failed", { chapterId: current.id, error: cause.toString() });
						yield* setStage("failed", { current: 0, total: 0, detail: cause.toString() });
						rawRivetkitContext.broadcast("chapterPlanFailed", { chapterId: current.id, error: cause.toString() });
					}),
				),
			);

		/**
		 * Background render fiber. Renders all unrendered panels for this
		 * chapter. Auto-advances to compose.
		 */
		const runRender = (current: ChapterState): Effect.Effect<void, Error> =>
			Effect.gen(function* () {
				yield* setStage("rendering", { current: 0, total: 0, detail: "Loading panels" });

				// Read all panels for this project, filter to this chapter.
				const allPanels = yield* Effect.tryPromise({
					try: () => bridge.repo.panelSpecs.getByProjectId(current.projectId),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				const chapterPanels = allPanels.filter((p) => p.chapterId === current.id);
				const panelsToRender = chapterPanels.filter((p) => p.renderPrompt && !p.renderResultId) as PanelSpec[];

				yield* setStage("rendering", { current: 0, total: panelsToRender.length, detail: `Rendering ${panelsToRender.length} panels` });
				log.info("rendering panels", { chapterId: current.id, toRender: panelsToRender.length, alreadyRendered: chapterPanels.length - panelsToRender.length });

				for (let i = 0; i < panelsToRender.length; i++) {
					const panel = panelsToRender[i]!;
					const prompt = panel.renderPrompt!;

					yield* setStage("rendering", { current: i, total: panelsToRender.length, detail: `Panel ${i + 1}/${panelsToRender.length}` });

					const renderReq: PanelRenderRequest = {
						id: uuid(),
						panelId: panel.id,
						projectId: current.projectId,
						prompt,
						negativePrompt: undefined,
						seed: Math.floor(Math.random() * 1_000_000_000),
						width: 768,
						height: 1024,
						version: 0,
						createdAt: nowIso(),
						referenceImageKeys: [],
					};

					const result = yield* Effect.tryPromise({
						try: async () => {
							try { await bridge.repo.panelRenderRequests.create(renderReq); } catch { /* non-fatal */ }
							const result: PanelRenderResult = await bridge.getRenderer().render(renderReq);
							try { await bridge.repo.panelRenderResults.create(result); } catch { /* non-fatal */ }
							try {
								await bridge.repo.panelSpecs.patch(panel.id, { renderResultId: result.id, seed: result.seed ?? renderReq.seed });
							} catch { /* non-fatal */ }
							if (hasImageData(result)) {
								await bridge.storage.writeAsset(result.imageKey, result.imageData);
							}
							return result;
						},
						catch: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
					});

					log.info("panel rendered", { chapterId: current.id, panel: panel.id, key: result.imageKey, ms: result.durationMs ?? 0 });
					yield* Effect.sleep(10);
				}

				yield* setStage("rendering", { current: panelsToRender.length, total: panelsToRender.length, detail: "All panels rendered" });
				log.info("render complete", { chapterId: current.id, rendered: panelsToRender.length });

				// Auto-advance to compose.
				yield* runCompose(current);
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.gen(function* () {
						log.error("render fiber failed", { chapterId: current.id, error: cause.toString() });
						yield* setStage("failed", { current: 0, total: 0, detail: cause.toString() });
						rawRivetkitContext.broadcast("chapterRenderFailed", { chapterId: current.id, error: cause.toString() });
					}),
				),
			);

		/**
		 * Background compose fiber. Composes pages + lettering for this
		 * chapter. Sets stage to done.
		 */
		const runCompose = (current: ChapterState): Effect.Effect<void, Error> =>
			Effect.gen(function* () {
				yield* setStage("composing", { current: 0, total: 2, detail: "Composing pages" });

				// Read pages and panels for this chapter from DB.
				const allPages = yield* Effect.tryPromise({
					try: () => bridge.repo.pageSpecs.getByProjectId(current.projectId),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				const allPanels = yield* Effect.tryPromise({
					try: () => bridge.repo.panelSpecs.getByProjectId(current.projectId),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				const chapterPages = allPages.filter((p) => p.chapterId === current.id);

				for (const page of chapterPages) {
					const pagePanels = allPanels.filter((p) => p.pageId === page.id);

					// Read each rendered panel image from storage.
					const panelImages: Buffer[] = [];
					for (const panel of pagePanels) {
						if (!panel.renderResultId) continue;
						const result = yield* Effect.tryPromise({
							try: () => bridge.repo.panelRenderResults.getById(panel.renderResultId!),
							catch: () => Promise.resolve(null),
						});
						if (!result) continue;
						const img = yield* Effect.tryPromise({
							try: () => bridge.storage.readAsset(result.imageKey),
							catch: (e) => (e instanceof Error ? e : new Error(String(e))),
						});
						panelImages.push(img);
					}

					if (panelImages.length === 0) continue;

					// Compose the page image.
					const composed = yield* Effect.tryPromise({
						try: () => bridge.composePage(panelImages, page, pagePanels, { width: 1200, height: 1600 }),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					});

					const key = pageImageKey(current.projectId, page.id, 0);
					yield* Effect.tryPromise({
						try: () => bridge.storage.writeAsset(key, composed),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					});

					const composite: PageComposite = {
						id: uuid(),
						pageId: page.id,
						projectId: current.projectId,
						imageKey: key,
						width: 1200,
						height: 1600,
						panelImageKeys: pagePanels.map((p) => p.id),
						createdAt: nowIso(),
						version: 0,
					};
					yield* Effect.tryPromise({
						try: () => bridge.repo.pageComposites.create(composite),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					});
					yield* Effect.tryPromise({
						try: () => bridge.repo.pageSpecs.patch(page.id, { compositeId: composite.id }),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					});
				}

				yield* setStage("composing", { current: 1, total: 2, detail: "Lettering" });

				// Lettering: extract dialogue and render SVG overlays.
				for (const page of chapterPages) {
					const pagePanels = allPanels.filter((p) => p.pageId === page.id);
					const allDialogue: LetteringBox[] = pagePanels.flatMap((p) =>
						p.dialogueLines.map((d, i) => ({
							id: uuid(),
							type: d.type,
							text: d.text,
							bbox: { x: 0.05, y: 0.05 + i * 0.1, w: 0.9, h: 0.08 },
							panelId: p.id,
							speaker: d.speaker,
						})),
					);

					if (allDialogue.length === 0) continue;

					const spec: LetteringSpec = {
						id: uuid(),
						pageId: page.id,
						projectId: current.projectId,
						boxes: allDialogue,
						version: 0,
						createdAt: nowIso(),
					};

					const svg = yield* Effect.tryPromise(() =>
						bridge.renderLettering(spec as never, 1200, 1600),
					);
					const key = letteringKey(current.projectId, page.id, 0);
					yield* Effect.tryPromise(() =>
						bridge.storage.writeAsset(key, Buffer.from(svg)),
					);
					yield* Effect.tryPromise(() => bridge.repo.letteringSpecs.create(spec));
				}

				yield* setStage("done", { current: 2, total: 2, detail: "Complete" });
				log.info("compose complete", { chapterId: current.id, pages: chapterPages.length });
				rawRivetkitContext.broadcast("chapterDone", { chapterId: current.id });
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.gen(function* () {
						log.error("compose fiber failed", { chapterId: current.id, error: cause.toString() });
						yield* setStage("failed", { current: 0, total: 0, detail: cause.toString() });
						rawRivetkitContext.broadcast("chapterComposeFailed", { chapterId: current.id, error: cause.toString() });
					}),
				),
			);

			/**
			 * Background transcription fiber. Downloads the linked source asset,
			 * spills it to a temp file (the adapter reads from a path), runs the
			 * transcription adapter, persists each chunk to the repository, then
			 * flips the chapter to `transcribed` / `completed` and broadcasts
			 * `chapterTranscribed`. Any failure marks the chapter `failed` and
			 * broadcasts `chapterTranscriptionFailed`.
			 */
			const runTranscription = (current: ChapterState): Effect.Effect<void, Error> =>
				Effect.gen(function* () {
					const assetId = current.sourceAssetId;
					if (!assetId) {
						yield* Effect.fail(
							new Error("StartTranscription: no sourceAssetId linked"),
						);
					}
				log.info("transcription fiber started", { chapterId: current.id, assetId });

					// 1. Resolve the linked SourceAsset row.
					const asset = yield* Effect.tryPromise({
						try: () => bridge.repo.sourceAssets.getById(assetId!),
						catch: (e) =>
							e instanceof Error ? e : new Error(String(e)),
					});
					if (!asset) {
						yield* Effect.fail(
							new Error(
								`StartTranscription: source asset ${assetId} not found`,
							),
						);
					}
				log.info("resolved source asset", { assetId, storageKey: asset!.storageKey });

					// 2. Download the audio bytes from blob storage.
					const buffer = yield* Effect.tryPromise({
						try: () => bridge.storage.readAsset(asset!.storageKey),
						catch: (e) =>
							e instanceof Error ? e : new Error(String(e)),
					});
				log.info("downloaded audio from storage", { storageKey: asset!.storageKey, bytes: buffer.length });

				// 3. Spill the downloaded audio to a temp file.
				//    The transcription adapter handles format conversion +
				//    compression internally (silenceremove + low-bitrate mp3).
				//    The original stays in blob storage untouched for export.
				const rawTmpPath = join(tmpdir(), `chapter-${current.id}-${uuid()}.${asset!.filename.split('.').pop() ?? 'raw'}`);
				yield* Effect.tryPromise({
					try: () => fs.writeFile(rawTmpPath, buffer),
					catch: (e) =>
						e instanceof Error ? e : new Error(String(e)),
				});
				log.debug("spilled audio to temp file", { rawTmpPath, bytes: buffer.length });

				try {
					// 4. Run the transcription adapter directly on the raw file.
					//    The adapter does silenceremove + compresses to 32 kbps mono
					//    mp3 before sending to Groq, keeping the upload well under
					//    the 25 MB API limit even for long audiobook chapters.
					const adapter = bridge.getTranscriptionAdapter();
					const result: TranscriptResult = yield* Effect.tryPromise({
						try: () =>
							adapter.transcribe(rawTmpPath, {
								projectId: current.projectId,
								chapterId: current.id,
							} as unknown as TranscriptionOptions),
						catch: (e) =>
							e instanceof Error ? e : new Error(String(e)),
					});
				log.info("transcription adapter returned", { chunks: result.chunks.length, durationSec: result.durationSec });

						// 5. Persist each chunk, stamped with this chapter id.
						yield* Effect.tryPromise({
							try: () =>
								Promise.all(
									result.chunks.map((chunk) =>
										bridge.repo.transcriptChunks.create({
											...chunk,
											id: uuid(),
											projectId: current.projectId,
											chapterId: current.id,
										}),
									),
								),
							catch: (e) =>
								e instanceof Error ? e : new Error(String(e)),
						});
						log.info("persisted transcript chunks", { count: result.chunks.length, chapterId: current.id });

						// 6. Flip to completed and broadcast.
						const done = yield* update((s) => ({
							...s,
							transcriptionStatus: "completed",
							status: "transcribed",
							durationSec: result.durationSec ?? s.durationSec,
						}));
						log.info("chapter transcription completed", { chapterId: current.id, status: done.status });
						rawRivetkitContext.broadcast("chapterTranscribed", done);

					// 7. Sync status back to the chapters table.
					yield* Effect.tryPromise({
						try: () =>
							bridge.repo.chapters.patch(current.id, {
								status: "transcribed",
								transcriptionStatus: "completed",
								durationSec: result.durationSec ?? undefined,
							} as Partial<unknown>),
						catch: (e) =>
							e instanceof Error ? e : new Error(String(e)),
					}).pipe(Effect.ignore);

					// 8. Auto-advance: start ingest fiber.
					// Transcription is done → automatically begin knowledge ingestion.
					// This chains: ingest → plan → ready_for_review.
					const afterTranscribe = yield* getState();
					yield* runIngest(afterTranscribe).pipe(Effect.forkDetach);
				} finally {
					// Clean up the temp file. The adapter creates its own
					// temp file and cleans it up internally.
					yield* Effect.tryPromise({
						try: () => fs.unlink(rawTmpPath),
						catch: (e) =>
							e instanceof Error ? e : new Error(String(e)),
					}).pipe(Effect.ignore);
				}
				}).pipe(
					Effect.catchCause((cause) =>
						Effect.gen(function* () {
						log.error("transcription fiber failed", { chapterId: current.id, error: cause.toString() });
							const failed = yield* update((s) => ({
								...s,
								transcriptionStatus: "failed",
								status: "failed",
							}));

							// Sync failure status back to the chapters table.
							yield* Effect.tryPromise({
								try: () =>
									bridge.repo.chapters.patch(failed.id, {
										status: "failed",
										transcriptionStatus: "failed",
									} as Partial<unknown>),
								catch: (e) =>
									e instanceof Error ? e : new Error(String(e)),
							}).pipe(Effect.ignore);

							rawRivetkitContext.broadcast(
								"chapterTranscriptionFailed",
								{
									chapterId: failed.id,
									error: cause.toString(),
								},
							);
							yield* Effect.logError(
								`chapter ${failed.id} transcription failed: ${cause.toString()}`,
							);
						}),
					),
				);

			return Chapter.of({
				GetState: () => getState(),

			Init: ({ payload }) =>
				update((current) => ({
					...current,
					id: payload.id,
					projectId: payload.projectId,
					index: payload.index,
				})),

				UpdateTitle: ({ payload }) =>
					update((current) => ({
						...current,
						title: payload.title,
					})),

				UpdateDescription: ({ payload }) =>
					update((current) => ({
						...current,
						description: payload.description,
					})),

				LinkAsset: ({ payload }) =>
					update((current) => ({
						...current,
						sourceAssetId: payload.sourceAssetId,
					})),

				SetStatus: ({ payload }) =>
					update((current) => ({
						...current,
						status: payload.status,
					})),

				SetTranscriptionStatus: ({ payload }) =>
					update((current) => ({
						...current,
						transcriptionStatus: payload.status,
					})),

			SetStage: ({ payload }) =>
				setStage(payload.stage, payload.progress),

			StartIngest: () =>
				Effect.gen(function* () {
					const current = yield* getState();
					const running = yield* setStage("ingesting", { current: 0, total: 3, detail: "Starting" });
					yield* runIngest(running).pipe(Effect.forkDetach);
					return running;
				}),

			StartPlan: () =>
				Effect.gen(function* () {
					const current = yield* getState();
					const running = yield* setStage("planning", { current: 0, total: 4, detail: "Starting" });
					yield* runPlan(running).pipe(Effect.forkDetach);
					return running;
				}),

			StartRender: () =>
				Effect.gen(function* () {
					const current = yield* getState();
					const running = yield* setStage("rendering", { current: 0, total: 0, detail: "Starting" });
					yield* runRender(running).pipe(Effect.forkDetach);
					return running;
				}),

			StartCompose: () =>
				Effect.gen(function* () {
					const current = yield* getState();
					const running = yield* setStage("composing", { current: 0, total: 2, detail: "Starting" });
					yield* runCompose(running).pipe(Effect.forkDetach);
					return running;
				}),

				StartTranscription: () =>
					Effect.gen(function* () {
						const current = yield* getState();
					if (!current.sourceAssetId) {
						yield* Effect.fail(
							new Error("StartTranscription: no sourceAssetId linked"),
						);
					}

					// Mark running immediately and broadcast.
					const running = yield* update((s) => ({
						...s,
						transcriptionStatus: "running",
						status: "transcribing",
						stage: "transcribing",
						stageProgress: { current: 0, total: 0, detail: "Transcribing audio" },
					}));

						// Fork a daemon fiber so the action returns now while
						// transcription continues in the background.
					yield* runTranscription(running).pipe(Effect.forkDetach);

						return running;
					}),

				GetPipelineStatus: () =>
					Effect.gen(function* () {
						const current = yield* getState();
						return current.pipelineId;
					}),
			});
		}),
	{
		state: {
			schema: ChapterState,
			initialValue: freshState,
		},
	},
);
