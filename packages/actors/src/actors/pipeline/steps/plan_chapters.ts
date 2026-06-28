import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { uuid } from "@audiocomic/shared";
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

const DEFAULT_MAX_PAGES = 4;
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

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const step = items.length / max;
  for (let i = 0; i < max; i++) {
    out.push(items[Math.floor(i * step)]!);
  }
  return out;
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
        const agent = bridge.getStoryPlannerAgent(ctx.projectId);
        const storyResult = yield* Effect.tryPromise({
          try: () =>
            agent.planStory({
              projectId: ctx.projectId,
              text: chapterText,
              emit: ctx.emit,
            }),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        });

        const sections: StorySection[] = storyResult.sections;
        const characters: CharacterProfile[] = storyResult.characters;
        const worldBible: WorldBible = storyResult.worldBible;

        // Persist story data (non-fatal).
        yield* Effect.tryPromise({
          try: () =>
            Promise.all([
              Promise.all(sections.map((s) => bridge.repo.storySections.create(s))),
              Promise.all(characters.map((c) => bridge.repo.characterProfiles.create(c))),
            ]),
          catch: (e) => new Error(`plan_chapters: DB persist failed (non-fatal): ${e}`),
        }).pipe(Effect.catch((e: Error) => Effect.logInfo(e.message)));

        // --- 3. Plan pages: divide beats into pages/panels ---
        const beats = sections.filter(isBeatSection);
        if (beats.length === 0) {
          yield* Effect.logWarning(
            `plan_chapters: no beats for chapter ${chapter.id}, skipping pages`,
          );
          continue;
        }

        const maxBeats = DEFAULT_MAX_PAGES * DEFAULT_BEATS_PER_PAGE;
        const selected = sampleEvenly(beats, maxBeats);

        const pages: PageSpec[] = [];
        const panels: PanelSpec[] = [];

        for (let pageIdx = 0; pageIdx < DEFAULT_MAX_PAGES; pageIdx++) {
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
              characters: beat.charactersPresent.map((charId) => ({ characterId: charId })),
              dialogueLines: [],
              startSec: beat.startSec,
              endSec: beat.endSec,
              qaStatus: "pending",
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
