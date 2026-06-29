import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { storageKey } from "@audiocomic/shared";
import type { PanelRenderRequest, PanelRenderResult } from "@audiocomic/domain";

/**
 * Generate Refs — produces canonical face reference images for each
 * character profile in the project.
 *
 * For each character without a `canonicalFaceRef`, generates a simple
 * portrait/headshot from the character's description using the configured
 * text-to-image renderer. The resulting storage key is persisted onto
 * `CharacterProfile.canonicalFaceRef` so `render_panels` can pass it
 * as a `referenceImageKey` for image-to-image conditioning.
 *
 * Depends on: build_bibles (ensures character profiles exist)
 * Output: `{ charactersProcessed, refsGenerated, skipped }`
 */

export interface GenerateRefsResult {
  step: "generate_refs";
  status: "completed";
  charactersProcessed: number;
  refsGenerated: number;
  skipped: number;
}

/** Build a face-reference prompt from a character profile description. */
function faceRefPrompt(name: string, description: string): string {
  return (
    `Character reference sheet — single headshot portrait of ${name}. ` +
    `${description}. ` +
    `Front-facing, neutral expression, plain background, ` +
    `consistent lighting, high detail face, no text, no watermark.`
  );
}

export const GenerateRefsStep: StepExecutor = {
  type: "generate_refs",
  inputs: ["build_bibles"],
  outputs: ["generate_refs"],
  execute: (ctx: StepContext) =>
    Effect.gen(function* () {
      const bridge = yield* PipelineBridge;

      // Fetch all character profiles for this project.
      const characters = yield* Effect.tryPromise({
        try: () => bridge.repo.characterProfiles.getByProjectId(ctx.projectId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      if (characters.length === 0) {
        yield* Effect.logInfo("generate_refs: no character profiles, skipping");
        return {
          inputHash: ctx.inputHash ?? "",
          data: {
            step: "generate_refs" as const,
            status: "completed" as const,
            charactersProcessed: 0,
            refsGenerated: 0,
            skipped: 0,
          } satisfies GenerateRefsResult,
          summary: "no characters",
        } satisfies StepOutput;
      }

      // Only generate refs for characters that don't already have one
      // and aren't user-locked (locked profiles are left alone).
      const needing = characters.filter(
        (c) => !c.canonicalFaceRef && !c.locked,
      );

      ctx.emit({
        type: "progress" as const,
        label: "generate_refs",
        current: 0,
        total: needing.length,
        detail: `${needing.length} characters need face refs (${characters.length - needing.length} already have refs)`,
      });

      const renderer = bridge.getRenderer();
      let refsGenerated = 0;
      let skipped = characters.length - needing.length;

      for (let i = 0; i < needing.length; i++) {
        if (ctx.shouldAbort?.()) {
          yield* Effect.logInfo("generate_refs: aborted by user");
          break;
        }

        const char = needing[i]!;
        const prompt = faceRefPrompt(char.name, char.description);

        ctx.emit({
          type: "substep_start" as const,
          label: `character ${i + 1}/${needing.length}`,
          current: i + 1,
          total: needing.length,
          detail: `${char.name} — generating face ref`,
        });

        const renderReq: PanelRenderRequest = {
          id: crypto.randomUUID(),
          panelId: crypto.randomUUID(), // synthetic — no panel for refs
          projectId: ctx.projectId,
          prompt,
          negativePrompt: "multiple people, text, watermark, low quality, blurry",
          seed: Math.floor(Math.random() * 1_000_000_000),
          width: 512,
          height: 512,
          version: 0,
          createdAt: new Date().toISOString(),
          referenceImageKeys: [],
        };

        const refKey = yield* Effect.tryPromise({
          try: async () => {
            const renderResult = await renderer.render(renderReq);

            // If the renderer returned inline image data, re-store it
            // under a stable key for the character.
            if ("imageData" in renderResult && renderResult.imageData) {
              const key = storageKey(
                ctx.projectId,
                "refs",
                `face-${char.id}.png`,
              );
              await bridge.storage.writeAsset(key, Buffer.from(renderResult.imageData as Uint8Array));
              return key;
            }

            // If no inline image data, the renderer already wrote to
            // storage — use the imageKey directly.
            return renderResult.imageKey;
          },
          catch: (e: unknown) =>
            e instanceof Error ? e : new Error(String(e)),
        });

        // Persist the ref key onto the character profile.
        yield* Effect.tryPromise({
          try: () =>
            bridge.repo.characterProfiles.patch(char.id, {
              canonicalFaceRef: refKey,
            }),
          catch: (e) =>
            new Error(`generate_refs: failed to patch character ${char.id}: ${e}`),
        }).pipe(
          Effect.catch((e: Error) => Effect.logInfo(e.message)),
        );

        refsGenerated += 1;

        ctx.emit({
          type: "substep_done" as const,
          label: `character ${i + 1}/${needing.length}`,
          current: i + 1,
          total: needing.length,
          detail: `${char.name} → ${refKey}`,
        });

        yield* Effect.logInfo(
          `generate_refs: ${char.name} → ${refKey}`,
        );

        // Small delay between requests to avoid rate limits.
        yield* Effect.sleep(10);
      }

      ctx.emit({
        type: "progress" as const,
        label: "generate_refs",
        current: needing.length,
        total: needing.length,
        detail: `Done: ${refsGenerated} refs generated, ${skipped} skipped`,
      });

      yield* Effect.logInfo(
        `generate_refs: ${refsGenerated} refs generated, ${skipped} skipped`,
      );

      return {
        inputHash: ctx.inputHash ?? "",
        data: {
          step: "generate_refs" as const,
          status: "completed" as const,
          charactersProcessed: characters.length,
          refsGenerated,
          skipped,
        } satisfies GenerateRefsResult,
        summary: `${refsGenerated} face refs generated`,
      } satisfies StepOutput;
    }),
};

registerStep(GenerateRefsStep);
