import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { uuid } from "@audiocomic/shared";
import { composePanelPrompt, composeNegativePrompt, backfillBeatCharacters, extractDialogueFromBeatText } from "@audiocomic/ai";
import type { StorySection, PageSpec, PanelSpec, CharacterProfile, WorldBible } from "@audiocomic/domain";

/**
 * Layout Panels — re-lays-out pages and panels from existing story beats.
 *
 * This step reads beat-level story sections from the DB, deletes existing
 * pages/panels for each chapter, and creates new ones with full-width
 * panel layout. It also recomposes render prompts.
 *
 * Use this to fix panel dimensions on existing projects without re-running
 * the full story planner (plan_chapters).
 *
 * Depends on: plan_chapters (needs story sections + characters + world bible)
 * Output: `{ chaptersProcessed, totalPages, totalPanels }`
 */

export interface LayoutPanelsResult {
  step: "layout_panels";
  status: "completed";
  chaptersProcessed: number;
  totalPages: number;
  totalPanels: number;
}

const BEATS_PER_PAGE = 3;

function isBeatSection(v: unknown): v is StorySection {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.level === "beat" && typeof r.summary === "string" && Array.isArray(r.charactersPresent);
}

export const LayoutPanelsStep: StepExecutor = {
  type: "layout_panels",
  inputs: ["plan_chapters"],
  outputs: ["layout_panels"],
  execute: (ctx: StepContext) =>
    Effect.gen(function* () {
      const bridge = yield* PipelineBridge;

      // Fetch all chapters, story sections, characters, and world bible.
      const chapters = yield* Effect.tryPromise({
        try: () => bridge.repo.chapters.getByProjectId(ctx.projectId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      const allSections = yield* Effect.tryPromise({
        try: () => bridge.repo.storySections.getByProjectId(ctx.projectId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      const characters = yield* Effect.tryPromise({
        try: () => bridge.repo.characterProfiles.getByProjectId(ctx.projectId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      const worldBibles = yield* Effect.tryPromise({
        try: () => bridge.repo.worldBibles.getByProjectId(ctx.projectId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      const worldBible: WorldBible = worldBibles[0] ?? {
        id: uuid(),
        projectId: ctx.projectId,
        setting: "",
        genre: [],
        tone: "neutral",
        artStyle: "",
        artStyleNegative: [],
        colorPalette: [],
        worldRules: [],
      };

      const sectionMap = new Map(allSections.map((s) => [s.id, s]));
      const charById = new Map(characters.map((c) => [c.id, c]));

      ctx.emit({
        type: "progress" as const,
        label: "layout_panels",
        current: 0,
        total: chapters.length,
        detail: `Re-laying out ${chapters.length} chapters`,
      });

      let totalPages = 0;
      let totalPanels = 0;

      for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
        if (ctx.shouldAbort?.()) {
          yield* Effect.logInfo("layout_panels: aborted by user");
          break;
        }

        const chapter = chapters[chIdx]!;

        // Gather beats for this chapter via the section hierarchy.
        // Beats → scenes → chapter sections. We need to find beats whose
        // parent scene belongs to this chapter's story sections.
        const chapterSections = allSections.filter((s) => s.level === "chapter");
        const beats = allSections.filter(isBeatSection);

        // Match beats to chapters by walking the parent chain.
        const chapterBeats = beats.filter((beat) => {
          let current: StorySection | undefined = beat;
          while (current?.parentId) {
            const parent = sectionMap.get(current.parentId);
            if (!parent) return false;
            if (parent.level === "chapter") {
              // Check if this chapter section corresponds to this DB chapter.
              // We match by index since story_sections don't store chapter_id directly.
              const chapterIndex = chapterSections.findIndex((cs) => cs.id === parent!.id);
              return chapterIndex === chapter.index;
            }
            current = parent;
          }
          return false;
        });
        // Sort beats by scene index, then beat index within scene —
        // the DB returns sections in arbitrary order, so without this
        // beats from different scenes interleave (all idx=0 first, etc).
        chapterBeats.sort((a, b) => {
          const sceneA = sectionMap.get(a.parentId ?? "");
          const sceneB = sectionMap.get(b.parentId ?? "");
          const sceneIdxA = sceneA?.index ?? 0;
          const sceneIdxB = sceneB?.index ?? 0;
          if (sceneIdxA !== sceneIdxB) return sceneIdxA - sceneIdxB;
          return (a.index ?? 0) - (b.index ?? 0);
        });

        if (chapterBeats.length === 0) {
          yield* Effect.logWarning(
            `layout_panels: no beats found for chapter ${chapter.index}, skipping`,
          );
          continue;
        }

        ctx.emit({
          type: "progress" as const,
          label: "layout_panels",
          current: chIdx,
          total: chapters.length,
          detail: `Chapter ${chapter.index + 1}: ${chapterBeats.length} beats → ${Math.ceil(chapterBeats.length / BEATS_PER_PAGE)} pages`,
        });

        // Delete existing pages and panels for this chapter.
        const existingPages = yield* Effect.tryPromise({
          try: () => bridge.repo.pageSpecs.getByProjectId(ctx.projectId),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        });
        const chapterPages = existingPages.filter((p) => p.chapterId === chapter.id);

        for (const page of chapterPages) {
          // Delete panels belonging to this page.
          const existingPanels = yield* Effect.tryPromise({
            try: () => bridge.repo.panelSpecs.getByProjectId(ctx.projectId),
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          });
          const pagePanels = existingPanels.filter((p) => p.pageId === page.id);
          for (const panel of pagePanels) {
            yield* Effect.tryPromise({
              try: () => bridge.repo.panelSpecs.delete(panel.id),
              catch: () => new Error("non-fatal"),
            }).pipe(Effect.catch(() => Effect.sync(() => {})));
          }
          // Delete the page.
          yield* Effect.tryPromise({
            try: () => bridge.repo.pageSpecs.delete(page.id),
            catch: () => new Error("non-fatal"),
          }).pipe(Effect.catch(() => Effect.sync(() => {})));
        }

        // Create new pages and panels with full-width layout.
        const pageCount = Math.ceil(chapterBeats.length / BEATS_PER_PAGE);
        const pages: PageSpec[] = [];
        const panels: PanelSpec[] = [];

        for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
          const pageBeats = chapterBeats.slice(
            pageIdx * BEATS_PER_PAGE,
            (pageIdx + 1) * BEATS_PER_PAGE,
          );
          if (pageBeats.length === 0) break;

          const pageId = uuid();
          const panelIds: string[] = [];

          // Full-width panels with even vertical spacing.
          const margin = 0.05, gap = 0.02;
          const panelW = 1 - 2 * margin;
          const availH = 1 - 2 * margin - (pageBeats.length - 1) * gap;
          const panelH = availH / pageBeats.length;
          const xCenter = margin;
          const totalH = pageBeats.length * panelH + (pageBeats.length - 1) * gap;
          const yStart = (1 - totalH) / 2;

          for (let panelIdx = 0; panelIdx < pageBeats.length; panelIdx++) {
            const beat = pageBeats[panelIdx]!;
            const panelId = uuid();
            panelIds.push(panelId);

            const backfilledIds = backfillBeatCharacters(beat.summary, beat.charactersPresent, characters);
            const panelCharacters = backfilledIds
              .map((charId) => charById.get(charId))
              .filter((c): c is CharacterProfile => c !== undefined);

            const prompt = bridge.composePanelPrompt(
              { id: panelId, storySectionId: beat.id, description: beat.summary } as PanelSpec,
              beat,
              panelCharacters,
              worldBible,
              allSections,
            );
            const negativePrompt = bridge.composeNegativePrompt(
              { characters: panelCharacters.map((c) => ({ characterId: c.id })) } as PanelSpec,
              panelCharacters,
              worldBible,
            );

            panels.push({
              id: panelId,
              pageId,
              projectId: ctx.projectId,
              chapterId: chapter.id,
              index: panelIdx,
              storySectionId: beat.id,
              bbox: {
                x: xCenter,
                y: yStart + panelIdx * (panelH + gap),
                w: panelW,
                h: panelH,
              },
              zIndex: panelIdx,
              description: beat.summary,
              cameraFraming: beat.cameraHint,
              characters: backfillBeatCharacters(beat.summary, beat.charactersPresent, characters).map((charId) => ({ characterId: charId })),
              dialogueLines: beat.text ? extractDialogueFromBeatText(beat.text, characters) : [],
              startSec: beat.startSec,
              endSec: beat.endSec,
              renderPrompt: prompt,
              renderNegativePrompt: negativePrompt,
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

        // Persist new pages and panels.
        yield* Effect.tryPromise({
          try: () =>
            Promise.all([
              Promise.all(pages.map((p) => bridge.repo.pageSpecs.create(p))),
              Promise.all(panels.map((p) => bridge.repo.panelSpecs.create(p))),
            ]),
          catch: (e) => new Error(`layout_panels: DB persist failed: ${e}`),
        });

        totalPages += pages.length;
        totalPanels += panels.length;

        yield* Effect.logInfo(
          `layout_panels: chapter ${chapter.index + 1} — ${pages.length} pages, ${panels.length} panels`,
        );
      }

      ctx.emit({
        type: "progress" as const,
        label: "layout_panels",
        current: chapters.length,
        total: chapters.length,
        detail: `Done: ${totalPages} pages, ${totalPanels} panels`,
      });

      return {
        inputHash: ctx.inputHash,
        data: {
          step: "layout_panels",
          status: "completed",
          chaptersProcessed: chapters.length,
          totalPages,
          totalPanels,
        } satisfies LayoutPanelsResult,
        summary: `${totalPages} pages, ${totalPanels} panels across ${chapters.length} chapters`,
      } satisfies StepOutput;
    }),
};

registerStep(LayoutPanelsStep);
