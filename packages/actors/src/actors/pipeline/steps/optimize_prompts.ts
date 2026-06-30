import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { optimizePanelPrompt, resolveLanguageModel, composeNegativePrompt, type LLMProvider, type OptimizePanelPromptInput } from "@audiocomic/ai";
import type { WorldBible, PanelSpec } from "@audiocomic/domain";
import { uuid } from "@audiocomic/shared";

/**
 * Optimize Prompts — LLM-powered text-to-image prompt optimization.
 *
 * Reads all panels for the project where `promptStale = true`, builds a full
 * context object (description + scene + tone + characters + dialog + camera +
 * world bible) for each, and asks the project's LLM to produce an optimized
 * image prompt. The result is cached on the panel (`renderPrompt` /
 * `renderNegativePrompt`) with `promptStale = false` so repeated renders don't
 * re-run the LLM.
 *
 * Sits between `layout_panels` and `render_panels` in the DAG.
 * Output: `{ optimized, skipped }`
 */

export interface OptimizePromptsResult {
  step: "optimize_prompts";
  status: "completed";
  optimized: number;
  skipped: number;
}

// Pixel-space aspect ratio (bbox is normalized to a non-square page).
// Mirrors composePanelPrompt's computation.
const PAGE_W = 800;
const PAGE_H = 1131;

function aspectRatioString(panel: PanelSpec): string {
  const aspect = (panel.bbox.w * PAGE_W) / (panel.bbox.h * PAGE_H);
  if (aspect > 1.3) return `wide horizontal panel, aspect ratio ${aspect.toFixed(1)}:1`;
  if (aspect < 0.77) return `tall vertical panel, aspect ratio 1:${(1 / aspect).toFixed(1)}`;
  return "roughly square panel, aspect ratio 1:1";
}

export const OptimizePromptsStep: StepExecutor = {
  type: "optimize_prompts",
  inputs: ["layout_panels"],
  outputs: ["optimize_prompts"],
  execute: (ctx: StepContext) =>
    Effect.gen(function* () {
      const bridge = yield* PipelineBridge;

      // Load all panels, story sections, characters, world bible, and project.
      const allPanels = yield* Effect.tryPromise({
        try: () => bridge.repo.panelSpecs.getByProjectId(ctx.projectId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      const stalePanels = allPanels.filter((p) => p.promptStale) as PanelSpec[];

      const allSections = yield* Effect.tryPromise({
        try: () => bridge.repo.storySections.getByProjectId(ctx.projectId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      const allCharacters = yield* Effect.tryPromise({
        try: () => bridge.repo.characterProfiles.getByProjectId(ctx.projectId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      const worldBibles = yield* Effect.tryPromise({
        try: () => bridge.repo.worldBibles.getByProjectId(ctx.projectId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      const project = yield* Effect.tryPromise({
        try: () => bridge.repo.projects.getById(ctx.projectId),
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
      const charById = new Map(allCharacters.map((c) => [c.id, c]));

      // Resolve the project's LLM model (project config with env fallback).
      const provider = (project?.llmProvider ?? bridge.env.LLM_PROVIDER) as LLMProvider | undefined;
      const modelName = project?.llmModel ?? bridge.env.DEFAULT_LLM_MODEL;
      if (!provider || !modelName) {
        yield* Effect.logInfo(
          `optimize_prompts: no LLM provider/model configured — skipping ${stalePanels.length} stale panels`,
        );
        ctx.emit({
          type: "warning" as const,
          label: "optimize_prompts",
          detail: "No LLM provider/model configured; skipping prompt optimization",
        });
        return {
          inputHash: ctx.inputHash ?? "",
          data: {
            step: "optimize_prompts" as const,
            status: "completed" as const,
            optimized: 0,
            skipped: stalePanels.length,
          } satisfies OptimizePromptsResult,
          summary: `0 optimized, ${stalePanels.length} skipped (no LLM)`,
        } satisfies StepOutput;
      }

      let model;
      try {
        model = resolveLanguageModel(provider, modelName, bridge.env);
      } catch (e) {
        yield* Effect.logWarning(
          `optimize_prompts: failed to resolve LLM model — skipping ${stalePanels.length} stale panels: ${e instanceof Error ? e.message : String(e)}`,
        );
        return {
          inputHash: ctx.inputHash ?? "",
          data: {
            step: "optimize_prompts" as const,
            status: "completed" as const,
            optimized: 0,
            skipped: stalePanels.length,
          } satisfies OptimizePromptsResult,
          summary: `0 optimized, ${stalePanels.length} skipped (LLM resolve failed)`,
        } satisfies StepOutput;
      }

      const skippedCount = allPanels.length - stalePanels.length;
      yield* Effect.logInfo(
        `optimize_prompts: ${stalePanels.length} to optimize, ${skippedCount} already optimized`,
      );
      ctx.emit({
        type: "progress" as const,
        label: "optimize_prompts",
        current: 0,
        total: stalePanels.length,
        detail: `Optimizing ${stalePanels.length} panel prompts`,
      });

      let optimized = 0;

      for (let i = 0; i < stalePanels.length; i++) {
        if (ctx.shouldAbort?.()) {
          yield* Effect.logInfo("optimize_prompts: aborted by user");
          break;
        }

        const panel = stalePanels[i]!;
        const section = sectionMap.get(panel.storySectionId);

        ctx.emit({
          type: "substep_start" as const,
          label: `panel ${i + 1}/${stalePanels.length}`,
          current: i + 1,
          total: stalePanels.length,
          detail: panel.id,
        });

        // Resolve character profiles for this panel's slots.
        const panelCharacters: OptimizePanelPromptInput["characters"] = panel.characters
          .map((slot) => {
            const profile = charById.get(slot.characterId);
            if (!profile) return null;
            return {
              name: profile.name,
              description: profile.description,
              pose: slot.pose,
              expression: slot.expression,
              position: slot.position,
            };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);

        const input: OptimizePanelPromptInput = {
          panelDescription: panel.description,
          sourceText: section?.text,
          cameraFraming: panel.cameraFraming ?? section?.cameraHint,
          emotionalTone: section?.emotionalTone,
          characters: panelCharacters,
          dialogueLines: panel.dialogueLines.map((d) => ({
            speaker: d.speaker,
            text: d.text,
            type: d.type,
          })),
          sceneSummary: section?.summary,
          sceneObjects: section?.objects,
          worldSetting: worldBible.setting,
          worldArtStyle: project?.artStyle || worldBible.artStyle,
          worldColorPalette: worldBible.colorPalette,
          worldArtStyleNegative: worldBible.artStyleNegative,
          worldTone: worldBible.tone,
          aspectRatio: aspectRatioString(panel),
        };

        const result = yield* Effect.tryPromise({
          try: async () => optimizePanelPrompt(input, model),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        });

        // Negative prompt is deterministic (not LLM-generated) so the user
        // can tune it independently and it stays stable across regenerations.
        const negativePrompt = composeNegativePrompt(panel, allCharacters, worldBible);

        // Persist the optimized prompt + clear stale flag.
        yield* Effect.tryPromise({
          try: () =>
            bridge.repo.panelSpecs.patch(panel.id, {
              renderPrompt: result.prompt,
              renderNegativePrompt: negativePrompt,
              promptStale: false,
            }),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        });

        optimized += 1;

        yield* Effect.logInfo(
          `optimize_prompts: [${i + 1}/${stalePanels.length}] optimized panel ${panel.id}`,
        );
        ctx.emit({
          type: "substep_done" as const,
          label: `panel ${i + 1}/${stalePanels.length}`,
          current: i + 1,
          total: stalePanels.length,
          detail: `optimized → ${result.prompt.length} chars`,
        });
      }

      yield* Effect.logInfo(`optimize_prompts: ${optimized} optimized, ${skippedCount} skipped`);
      ctx.emit({
        type: "progress" as const,
        label: "optimize_prompts",
        current: optimized,
        total: stalePanels.length,
        detail: `${optimized} optimized, ${skippedCount} skipped`,
      });

      return {
        inputHash: ctx.inputHash ?? "",
        data: {
          step: "optimize_prompts" as const,
          status: "completed" as const,
          optimized,
          skipped: skippedCount,
        } satisfies OptimizePromptsResult,
        summary: `${optimized} optimized, ${skippedCount} skipped`,
      } satisfies StepOutput;
    }),
};

registerStep(OptimizePromptsStep);
