import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { getPrevResult, isPlanPagesResult, isPlanStoryResult } from "./helpers.ts";
import type { PanelSpec, StorySection, CharacterProfile } from "@audiocomic/domain";

// ─── compose_prompts step ───
// Builds a render prompt for each panel by joining the panel spec with its
// story section, the characters present, and the world bible. The composed
// prompt is persisted onto the panel spec and collected into a panelId->prompt
// map for the downstream render_panels step.
//
// depends on: plan_pages (panels), plan_story (characters, sections, worldBible)

/** Type guard: narrow an unknown to a PanelSpec (fields used by this step). */
function isPanelSpec(v: unknown): v is PanelSpec {
  return (
    typeof v === "object" &&
    v !== null &&
    "id" in v &&
    typeof (v as Record<string, unknown>).id === "string" &&
    "storySectionId" in v &&
    typeof (v as Record<string, unknown>).storySectionId === "string" &&
    "characters" in v &&
    Array.isArray((v as Record<string, unknown>).characters)
  );
}

/** Type guard: narrow an unknown to a StorySection. */
function isStorySection(v: unknown): v is StorySection {
  return (
    typeof v === "object" &&
    v !== null &&
    "id" in v &&
    typeof (v as Record<string, unknown>).id === "string"
  );
}

/** Type guard: narrow an unknown to a CharacterProfile. */
function isCharacterProfile(v: unknown): v is CharacterProfile {
  return (
    typeof v === "object" &&
    v !== null &&
    "id" in v &&
    typeof (v as Record<string, unknown>).id === "string"
  );
}

export interface ComposePromptsResult {
  step: "compose_prompts";
  status: "completed";
  panelPrompts: Map<string, string>;
}

export const ComposePromptsStep: StepExecutor = {
  type: "compose_prompts",
  inputs: ["plan_pages", "plan_story"] as const,
  outputs: ["compose_prompts"] as const,
  execute: (ctx: StepContext) =>
    Effect.gen(function* () {
      const bridge = yield* PipelineBridge;
      yield* Effect.logInfo("compose_prompts: composing render prompts for panels");

      // Read previous step results
      const planPages = getPrevResult(ctx, "plan_pages", isPlanPagesResult);
      const planStory = getPrevResult(ctx, "plan_story", isPlanStoryResult);

      // Narrow the untyped arrays from the guards into typed values
      const panels = planPages.panels.filter(isPanelSpec);
      const sections = planStory.sections.filter(isStorySection);
      const characters = planStory.characters.filter(isCharacterProfile);
      const worldBible = planStory.worldBible;

      // Build section lookup: sectionId -> StorySection
      const sectionMap = new Map<string, StorySection>(sections.map((s) => [s.id, s]));

      const panelPrompts = new Map<string, string>();

      for (const panel of panels) {
        const section = sectionMap.get(panel.storySectionId);
        if (!section) {
          yield* Effect.logWarning(
            `compose_prompts: panel ${panel.id} references missing section ${panel.storySectionId}; skipping`,
          );
          continue;
        }

        // Characters present in this panel
        const panelCharacters = characters.filter((c) =>
          panel.characters.some((pc) => pc.characterId === c.id),
        );

        // Compose the render prompt with full section memory (MangaFlow M_k)
        const prompt = bridge.composePanelPrompt(
          panel,
          section,
          panelCharacters,
          worldBible,
          sections,
        );
        const negativePrompt = bridge.composeNegativePrompt(panel, panelCharacters, worldBible);

        // Persist the prompt onto the panel spec
        yield* Effect.tryPromise(() =>
          bridge.repo.panelSpecs.patch(panel.id, {
            renderPrompt: prompt,
            renderNegativePrompt: negativePrompt,
          }),
        );

        panelPrompts.set(panel.id, prompt);
      }

      yield* Effect.logInfo(`compose_prompts: composed ${panelPrompts.size} panel prompts`);

      return {
        inputHash: ctx.inputHash ?? "",
        data: {
          step: "compose_prompts" as const,
          status: "completed" as const,
          panelPrompts,
        } satisfies ComposePromptsResult,
        summary: `${panelPrompts.size} panel prompts`,
      } satisfies StepOutput;
    }),
};

registerStep(ComposePromptsStep);
