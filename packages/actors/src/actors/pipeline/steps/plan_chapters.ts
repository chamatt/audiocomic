import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { uuid } from "@audiocomic/shared";
import { buildSectionMemory, backfillBeatCharacters } from "@audiocomic/ai";
import { createEmbeddingProvider } from "@audiocomic/knowledge";
import { mergeCharacters } from "../../../agents/merge.ts";
import type {
  StorySection,
  PageSpec,
  PanelSpec,
  CharacterProfile,
  WorldBible,
} from "@audiocomic/domain";

/**
 * Plan Chapters — the per-chapter planning step.
 *
 * For each transcribed chapter, this step:
 *   1. Segments: gathers that chapter's transcript chunks from DB
 *   2. Plans story: calls the Mastra story planner agent (with KB tools
 *      for cross-chapter consistency) to produce sections, characters,
 *      and a world bible for this chapter
 *   3. Plans pages: divides the chapter's story beats into pages/panels
 *   4. Composes prompts: builds render prompts for each panel
 *
 * All pages and panels are tagged with `chapterId` so the canvas can
 * group them by chapter. Story sections, characters, and world bible
 * are persisted to DB for the knowledge base.
 *
 * Depends on: build_bibles (ensures KB is enriched before planning)
 * Output: `{ chaptersPlanned, totalPages, totalPanels, chapterSummaries }`
 */

export interface PlanChaptersResult {
  step: "plan_chapters";
  status: "completed";
  chaptersPlanned: number;
  totalPages: number;
  totalPanels: number;
  chapterSummaries: { chapterId: string; title: string; pages: number; panels: number }[];
}

// --- Helpers (adapted from the old plan_pages + compose_prompts steps) ---

const DEFAULT_BEATS_PER_PAGE = 3;

function isBeatSection(v: unknown): v is StorySection {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.level === "beat" &&
    typeof r.id === "string" &&
    typeof r.summary === "string" &&
    Array.isArray(r.charactersPresent)
  );
}


export const PlanChaptersStep: StepExecutor = {
  type: "plan_chapters",
  inputs: ["build_bibles"],
  outputs: ["plan_chapters"],
  execute: (ctx: StepContext) =>
    Effect.gen(function* () {
      const bridge = yield* PipelineBridge;

      // Fetch all transcribed chapters for this project.
      const chapters = yield* Effect.tryPromise({
        try: () => bridge.repo.chapters.getByProjectId(ctx.projectId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      const transcribed = chapters.filter(
        (c) => c.transcriptionStatus === "completed" || c.status === "transcribed",
      );

      if (transcribed.length === 0) {
        return yield* Effect.fail(
          new Error(
            "plan_chapters: no transcribed chapters — upload and transcribe chapters first",
          ),
        );
      }

      ctx.emit({
        type: "progress" as const,
        label: "plan_chapters",
        current: 0,
        total: transcribed.length,
        detail: `Planning ${transcribed.length} chapters`,
      });

      let totalPages = 0;
      let totalPanels = 0;
      const chapterSummaries: PlanChaptersResult["chapterSummaries"] = [];

      for (let chIdx = 0; chIdx < transcribed.length; chIdx++) {
        if (ctx.shouldAbort?.()) {
          yield* Effect.logInfo("plan_chapters: aborted by user");
          break;
        }

        const chapter = transcribed[chIdx]!;

        ctx.emit({
          type: "progress" as const,
          label: "plan_chapters",
          current: chIdx,
          total: transcribed.length,
          detail: `Planning chapter ${chapter.index + 1}: ${chapter.title}`,
        });

        // --- 1. Segment: get this chapter's transcript chunks ---
        const allChunks = yield* Effect.tryPromise({
          try: () => bridge.repo.transcriptChunks.getByProjectId(ctx.projectId),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        });
        const chapterChunks = allChunks
          .filter((c) => c.chapterId === chapter.id)
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        const chapterText = chapterChunks.map((c) => c.text).join("\n\n");

        if (chapterText.length === 0) {
          yield* Effect.logWarning(
            `plan_chapters: chapter ${chapter.id} has no transcript text, skipping`,
          );
          continue;
        }

        // --- 2. Plan story: call the Mastra agent ---
        const agent = yield* Effect.promise(() => bridge.getStoryPlannerAgent(ctx.projectId));
        const storyResult = yield* Effect.tryPromise({
          try: () =>
            agent.planStory({
              projectId: ctx.projectId,
              text: chapterText,
              emit: ctx.emit,
            }),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        });

        let sections: StorySection[] = storyResult.sections;
        let characters: CharacterProfile[] = storyResult.characters;
        const worldBible: WorldBible = storyResult.worldBible;

        // Deduplicate characters against existing project roster.
        const mergeResult = yield* Effect.tryPromise({
          try: () => mergeCharacters(characters, sections, bridge.repo, ctx.projectId),
          catch: (e) => new Error(`plan_chapters: character merge failed (non-fatal): ${e}`),
        }).pipe(
          Effect.catch((e: Error) => {
            Effect.logInfo(e.message);
            return Effect.succeed(null);
          }),
        );
        if (mergeResult) {
          sections = mergeResult.sections;
          characters = mergeResult.characters;
        }

        // Persist story data (non-fatal).
        // Matched characters already exist (patched by mergeCharacters);
        // create() on them throws duplicate-key, which we swallow.
        yield* Effect.tryPromise({
          try: () =>
            Promise.all([
              Promise.all(sections.map((s) => bridge.repo.storySections.create(s))),
              Promise.all(
                characters.map((c) =>
                  bridge.repo.characterProfiles.create(c).catch(() => c),
                ),
              ),
            ]),
          catch: (e) => new Error(`plan_chapters: DB persist failed (non-fatal): ${e}`),
        }).pipe(Effect.catch((e: Error) => Effect.logInfo(e.message)));

        // --- 2b. Embed section memory for retrieval (MangaFlow M_k) ---
        // buildSectionMemory walks beat → scene → chapter parent chain to
        // produce a compact context string. We embed it and store in
        // story_sections.embedding so the section-query tool can retrieve
        // relevant sections from previous chapters during planning.
        yield* Effect.tryPromise({
          try: async () => {
            const embedder = createEmbeddingProvider(bridge.env);
            const beatSections = sections.filter((s) => s.level === "beat");
            if (beatSections.length === 0) return;

            // Build section memory strings for all beats, batch-embed them.
            const memoryStrings = beatSections.map((beat) =>
              buildSectionMemory(beat, sections, characters, worldBible),
            );
            const embeddings = await embedder.embedMany(memoryStrings);

            // Persist embeddings to DB (non-fatal per section).
            await Promise.all(
              beatSections.map((beat, i) =>
                bridge.repo.setEmbedding("storySections", beat.id, embeddings[i]!),
              ),
            );
          },
          catch: (e) =>
            new Error(`plan_chapters: section embedding failed (non-fatal): ${e}`),
        }).pipe(Effect.catch((e: Error) => Effect.logInfo(e.message)));

        // --- 3. Plan pages: divide beats into pages/panels ---
        const beats = sections.filter(isBeatSection);
        if (beats.length === 0) {
          yield* Effect.logWarning(
            `plan_chapters: no beats for chapter ${chapter.id}, skipping pages`,
          );
          continue;
        }

        // Use ALL beats — every beat gets its own panel.
        const selected = beats;
        const pageCount = Math.ceil(selected.length / DEFAULT_BEATS_PER_PAGE);

        const pages: PageSpec[] = [];
        const panels: PanelSpec[] = [];

        for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
          const pageBeats = selected.slice(
            pageIdx * DEFAULT_BEATS_PER_PAGE,
            (pageIdx + 1) * DEFAULT_BEATS_PER_PAGE,
          );
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
              projectId: ctx.projectId,
              chapterId: chapter.id,
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
              characters: backfillBeatCharacters(beat.summary, beat.charactersPresent, characters).map((charId) => ({ characterId: charId })),
              dialogueLines: [],
              startSec: beat.startSec,
              endSec: beat.endSec,
              qaStatus: "pending",
              promptStale: true,
            });
          }

          pages.push({
            id: pageId,
            projectId: ctx.projectId,
            chapterId: chapter.id,
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

        // --- 4. Compose prompts for each panel ---
        const sectionMap = new Map<string, StorySection>(sections.map((s) => [s.id, s]));

        for (const panel of panels) {
          const section = sectionMap.get(panel.storySectionId);
          if (!section) continue;

          const panelCharacters = characters.filter((c) =>
            panel.characters.some((pc) => pc.characterId === c.id),
          );

          const prompt = bridge.composePanelPrompt(
            panel,
            section,
            panelCharacters,
            worldBible,
            sections,
          );
          panel.renderPrompt = prompt;
          panel.renderNegativePrompt = bridge.composeNegativePrompt(
            panel,
            panelCharacters,
            worldBible,
          );

          // Persist the prompt onto the panel spec.
          yield* Effect.tryPromise(() =>
            bridge.repo.panelSpecs.patch(panel.id, {
              renderPrompt: prompt,
              renderNegativePrompt: panel.renderNegativePrompt,
            }),
          ).pipe(Effect.catch(() => Effect.sync(() => {})));
        }

        // Persist pages and panels (non-fatal).
        yield* Effect.tryPromise({
          try: () =>
            Promise.all([
              Promise.all(pages.map((p) => bridge.repo.pageSpecs.create(p))),
              Promise.all(panels.map((p) => bridge.repo.panelSpecs.create(p))),
            ]),
          catch: (e) => new Error(`plan_chapters: DB persist failed (non-fatal): ${e}`),
        }).pipe(Effect.catch((e: Error) => Effect.logInfo(e.message)));

        totalPages += pages.length;
        totalPanels += panels.length;
        chapterSummaries.push({
          chapterId: chapter.id,
          title: chapter.title,
          pages: pages.length,
          panels: panels.length,
        });

        yield* Effect.logInfo(
          `plan_chapters: chapter ${chapter.index + 1} "${chapter.title}" — ${pages.length} pages, ${panels.length} panels`,
        );
      }

      ctx.emit({
        type: "progress" as const,
        label: "plan_chapters",
        current: transcribed.length,
        total: transcribed.length,
        detail: `Done: ${chapterSummaries.length} chapters, ${totalPages} pages, ${totalPanels} panels`,
      });

      yield* Effect.logInfo(
        `plan_chapters: ${chapterSummaries.length} chapters planned, ${totalPages} pages, ${totalPanels} panels total`,
      );

      return {
        inputHash: ctx.inputHash ?? "",
        data: {
          step: "plan_chapters" as const,
          status: "completed" as const,
          chaptersPlanned: chapterSummaries.length,
          totalPages,
          totalPanels,
          chapterSummaries,
        } satisfies PlanChaptersResult,
        summary: `${chapterSummaries.length} chapters, ${totalPages} pages, ${totalPanels} panels`,
      } satisfies StepOutput;
    }),
};

registerStep(PlanChaptersStep);
