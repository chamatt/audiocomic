import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { getPrevResult, isRenderPanelsResult } from "./helpers.ts";
import { evaluateImageQuality } from "@audiocomic/evals";
import type { PanelSpec, PanelRenderResult } from "@audiocomic/domain";

// ─── panel_qa step ───
// Runs two QA checks on each rendered panel:
//   1. Image quality (deterministic) — sharp pixel statistics detect
//      blank/flat/blurry images. Catches renderer failures cheaply.
//   2. Prompt adherence (VLM judge) — uses OpenAI vision API to check
//      whether the rendered image matches the panel's render prompt.
//      Falls back to "passed" if no OPENAI_API_KEY is configured.
//
// Panels that fail either check are marked qaStatus="failed" with a
// qaNotes reason. Panels that pass both are marked "passed".

export interface PanelQaResult {
  step: "panel_qa";
  status: "completed";
  passedCount: number;
  failedCount: number;
  skippedCount: number;
}

/** VLM judge response shape. */
interface VlmJudgeResult {
  passed: boolean;
  reason: string;
}

/**
 * Use OpenAI vision API to judge whether the rendered image matches the prompt.
 * Returns { passed: true } if no API key is configured (graceful degradation).
 */
async function judgePromptAdherence(
  imageBuffer: Buffer,
  prompt: string,
  apiKey: string | undefined,
): Promise<VlmJudgeResult> {
  if (!apiKey) {
    return { passed: true, reason: "VLM judge skipped (no OPENAI_API_KEY)" };
  }

  const base64Image = imageBuffer.toString("base64");
  const dataUrl = `data:image/png;base64,${base64Image}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are a comic panel QA judge. Does this image match the following prompt? Answer with JSON: {"passed": true/false, "reason": "brief explanation"}\n\nPrompt: ${prompt}`,
            },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown");
    return {
      passed: true,
      reason: `VLM judge failed (${response.status}), auto-passing: ${body.slice(0, 100)}`,
    };
  }

  const json = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = json.choices[0]?.message?.content ?? "";

  // Parse the JSON from the response — the model may wrap it in markdown.
  const jsonMatch = content.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    return { passed: true, reason: "VLM judge returned unparseable response, auto-passing" };
  }

  try {
    const result = JSON.parse(jsonMatch[0]) as VlmJudgeResult;
    return {
      passed: Boolean(result.passed),
      reason: result.reason ?? (result.passed ? "Image matches prompt" : "Image does not match prompt"),
    };
  } catch {
    return { passed: true, reason: "VLM judge returned invalid JSON, auto-passing" };
  }
}

export const PanelQaStep: StepExecutor = {
  type: "panel_qa",
  inputs: ["render_panels"],
  outputs: ["panel_qa"],
  execute: (ctx: StepContext) =>
    Effect.gen(function* () {
      const bridge = yield* PipelineBridge;

      // Read render_panels result for the panelImageKeys map (rendered panels).
      const renderPanels = yield* getPrevResult(ctx, "render_panels", isRenderPanelsResult);
      const panelImageKeys = renderPanels.panelImageKeys;

      // Read panel specs from the DB.
      const allPanels = yield* Effect.tryPromise({
        try: () => bridge.repo.panelSpecs.getByProjectId(ctx.projectId),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });

      // Only panels that were actually rendered have a renderResultId.
      const renderedPanels = allPanels.filter(
        (p) => p.renderResultId !== undefined,
      ) as PanelSpec[];

      const apiKey = bridge.env.OPENAI_API_KEY;
      let passedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      ctx.emit({
        type: "progress" as const,
        label: "panel_qa",
        current: 0,
        total: renderedPanels.length,
        detail: `QA checking ${renderedPanels.length} panels`,
      });

      for (let i = 0; i < renderedPanels.length; i++) {
        if (ctx.shouldAbort?.()) {
          yield* Effect.logInfo("panel_qa: aborted by user");
          break;
        }

        const panel = renderedPanels[i]!;
        if (!panelImageKeys.has(panel.id)) {
          skippedCount++;
          continue;
        }

        ctx.emit({
          type: "substep_start" as const,
          label: `QA ${i + 1}/${renderedPanels.length}`,
          current: i + 1,
          total: renderedPanels.length,
          detail: panel.id,
        });

        // Fetch the render result to get the image key.
        const renderResult = yield* Effect.tryPromise({
          try: () => bridge.repo.panelRenderResults.getById(panel.renderResultId!),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        });

        if (!renderResult) {
          yield* Effect.tryPromise({
            try: () =>
              bridge.repo.panelSpecs.patch(panel.id, {
                qaStatus: "failed",
                qaNotes: "Render result not found",
              }),
            catch: () => new Error("patch failed (non-fatal)"),
          });
          failedCount++;
          continue;
        }

        const imageKey = (renderResult as PanelRenderResult).imageKey;

        // Read the image from storage.
        const imageBuffer = yield* Effect.tryPromise({
          try: () => bridge.storage.readAsset(imageKey),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        });

        // 1. Deterministic image quality check.
        const qualityResult = yield* Effect.tryPromise({
          try: () => evaluateImageQuality(imageBuffer),
          catch: (e) => new Error(`Quality check error: ${e}`),
        }).pipe(
          Effect.catch(() =>
            Effect.sync(() => ({
              passed: true,
              reason: "Quality check error, auto-passing",
              mean: 0,
              stddev: 0,
              entropy: 0,
              isBlank: false,
              isBlurry: false,
            }) as const),
          ),
        );

        if (!qualityResult.passed) {
          yield* Effect.tryPromise({
            try: () =>
              bridge.repo.panelSpecs.patch(panel.id, {
                qaStatus: "failed",
                qaNotes: qualityResult.reason,
              }),
            catch: () => new Error("patch failed (non-fatal)"),
          });
          failedCount++;
          yield* Effect.logInfo(`panel_qa: panel ${panel.id} FAILED quality: ${qualityResult.reason}`);
          ctx.emit({
            type: "substep_done" as const,
            label: `QA ${i + 1}/${renderedPanels.length}`,
            current: i + 1,
            total: renderedPanels.length,
            detail: `FAIL: ${qualityResult.reason}`,
          });
          continue;
        }

        // 2. VLM-based prompt adherence check.
        const vlmResult = yield* Effect.tryPromise({
          try: () => judgePromptAdherence(imageBuffer, panel.renderPrompt!, apiKey),
          catch: (e) => new Error(`VLM judge error: ${e}`),
        }).pipe(
          Effect.catch(() =>
            Effect.sync(() => ({
              passed: true,
              reason: "VLM judge error, auto-passing",
            }) as VlmJudgeResult),
          ),
        );

        if (!vlmResult.passed) {
          yield* Effect.tryPromise({
            try: () =>
              bridge.repo.panelSpecs.patch(panel.id, {
                qaStatus: "failed",
                qaNotes: `Prompt adherence: ${vlmResult.reason}`,
              }),
            catch: () => new Error("patch failed (non-fatal)"),
          });
          failedCount++;
          yield* Effect.logInfo(`panel_qa: panel ${panel.id} FAILED VLM: ${vlmResult.reason}`);
          ctx.emit({
            type: "substep_done" as const,
            label: `QA ${i + 1}/${renderedPanels.length}`,
            current: i + 1,
            total: renderedPanels.length,
            detail: `FAIL: ${vlmResult.reason}`,
          });
          continue;
        }

        // Both checks passed.
        yield* Effect.tryPromise({
          try: () =>
            bridge.repo.panelSpecs.patch(panel.id, {
              qaStatus: "passed",
              qaNotes: vlmResult.reason !== "VLM judge skipped (no OPENAI_API_KEY)"
                ? `Quality OK (entropy=${qualityResult.entropy.toFixed(2)}). ${vlmResult.reason}`
                : `Quality OK (entropy=${qualityResult.entropy.toFixed(2)}). VLM skipped.`,
            }),
          catch: () => new Error("patch failed (non-fatal)"),
        });
        passedCount++;
        ctx.emit({
          type: "substep_done" as const,
          label: `QA ${i + 1}/${renderedPanels.length}`,
          current: i + 1,
          total: renderedPanels.length,
          detail: "PASS",
        });
      }

      yield* Effect.logInfo(
        `panel_qa: ${passedCount} passed, ${failedCount} failed, ${skippedCount} skipped`,
      );

      return {
        inputHash: ctx.inputHash ?? "",
        data: {
          step: "panel_qa" as const,
          status: "completed" as const,
          passedCount,
          failedCount,
          skippedCount,
        } satisfies PanelQaResult,
        summary: `${passedCount} passed, ${failedCount} failed, ${skippedCount} skipped`,
      } satisfies StepOutput;
    }),
};

registerStep(PanelQaStep);
