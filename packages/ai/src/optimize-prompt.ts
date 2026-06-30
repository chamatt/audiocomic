/**
 * LLM-powered panel prompt optimization.
 *
 * Takes the full panel context (description, scene, tone, characters, dialog,
 * camera, world bible, source text) and asks an LLM to produce an optimal
 * text-to-image prompt. Replaces the rigid deterministic `composePanelPrompt`
 * for panels whose `promptStale` flag is set.
 */

import { generateText, type LanguageModelV1 } from "ai";
import { logger } from "@audiocomic/shared";
import type { LanguageModel } from "./types";

const log = logger.scoped("ai:optimize-prompt");

const SYSTEM_PROMPT = `You are a text-to-image prompt engineer for a comic book production pipeline.

You receive a structured JSON context describing a single comic panel. Your job is to convert it into ONE optimized text-to-image prompt for models like Flux / SDXL / Midjourney.

Rules:
1. Output a single comma-separated positive prompt on the FIRST line. No prose, no bullet points, no headers, no code fences.
2. Put VISUAL elements first (highest weight): subjects, characters, action, pose, expression. Then setting/background. Then style. Then technical (camera, aspect ratio, lighting).
3. Include ONLY visual information. Strip game stats, levels, abilities, backstory, relationships, personality traits, plot — the image model cannot draw those.
4. Convert each character's description into pure visual terms (species, body type, skin, hair, clothing, colors, distinctive features). Drop anything non-visual.
5. Strip any multi-panel / page-layout directives. No "split-panel", "panel-to-panel", "multi-panel", "page layout", "panel grid", "panel borders". The output is for ONE single illustration.
6. If sourceText is provided, use it as the PRIMARY narrative context — it is the verbatim text from the audiobook that the reader will HEAR while viewing this panel. The visual prompt must depict the scene, action, and mood described in the sourceText. Extract visual cues from dialogue (who is speaking, their emotional state) and narration (setting, atmosphere, action). The image must align with what the audio says at this moment.
7. If dialogue lines are present, instruct the image model to draw the comic lettering itself, rendering each line's text VERBATIM inside the appropriate bubble type: speech bubbles for speech (with a tail pointing at the speaker), thought bubbles for thought, narration caption boxes for narration, bold stylized SFX text for sfx. Format as: 'draw comic lettering: speech bubble from <speaker> with text "<text>", ...'. Do NOT say "leave empty space" or "do not draw text" — the model must render the actual text.
8. Express the aspect ratio explicitly when given (e.g. "wide horizontal panel, aspect ratio 2.2:1" or "tall vertical panel, aspect ratio 1:1.4" or "roughly square panel, aspect ratio 1:1").
9. ALWAYS include the world art style (worldArtStyle) in the style section of the prompt. This is the project's global visual identity — it MUST appear in every panel for consistency. If it contains multi-panel directives like "reaction panels" or "establishing shots", strip those phrases but keep the art technique (e.g. "bold character silhouettes", "expressive faces", "cel shading").
10. If worldColorPalette tags are provided, include them in the style section (e.g. "warm tones, muted colors, high contrast").
11. If emotionalTone is provided, translate it into concrete visual cues (e.g. "tense" → "tight body language, narrowed eyes, sharp shadows"; "joyful" → "bright eyes, wide smiles, warm lighting"). This is the per-scene mood — it overrides the global tone for this panel.
12. If worldTone is provided and emotionalTone is not, use worldTone as the mood cue instead.
13. On the SECOND line, output the negative prompt prefixed with "NEGATIVE:". Include: the world's artStyleNegative tags (if any), "no multi-panel page, no panel grid, no split frame, bad anatomy, deformed hands, extra digits, blurry, jpeg artifacts, watermark". Do NOT include "no text" or "no gibberish text" — the image must render legible speech-bubble lettering.

Output format (exactly two lines, nothing else):
<positive prompt>
NEGATIVE: <negative prompt>`;

export interface OptimizePanelPromptInput {
  panelDescription: string;
  cameraFraming?: string;
  emotionalTone?: string;
  characters: {
    name: string;
    description: string;
    pose?: string;
    expression?: string;
    position?: string;
  }[];
  sourceText?: string;
  sceneSummary?: string;
  dialogueLines: { speaker: string; text: string; type: string }[];
  sceneObjects?: string[];
  worldSetting?: string;
  worldArtStyle?: string;
  worldColorPalette?: string[];
  worldArtStyleNegative?: string[];
  worldTone?: string;
  aspectRatio: string;
}

export interface OptimizePanelPromptResult {
  prompt: string;
  negativePrompt: string;
}

/**
 * Build a simple deterministic fallback prompt from the context, used when the
 * LLM call fails. Mirrors the spirit of `composePanelPrompt` without the rigid
 * formatting.
 */
function fallbackPrompt(input: OptimizePanelPromptInput): OptimizePanelPromptResult {
  const charBits = input.characters
    .map((c) => {
      const bits: string[] = [];
      if (c.description) bits.push(c.description);
      if (c.pose) bits.push(c.pose);
      if (c.expression) bits.push(`${c.expression} expression`);
      if (c.position) bits.push(`positioned ${c.position} of frame`);
      return bits.join(", ");
    })
    .filter(Boolean);

  const parts: string[] = [];
  parts.push("A single illustration of one scene showing");
  if (charBits.length > 0) parts.push(charBits.join("; "));
  parts.push(input.panelDescription.replace(/^(A clear visual beat:?|The scene shows:?|We see:?)/gi, "").trim());
  if (input.sourceText) {
    // Include a condensed version of the source text for visual alignment.
    const excerpt = input.sourceText.length > 300
      ? input.sourceText.slice(0, 300) + "..."
      : input.sourceText;
    parts.push(`scene from: "${excerpt}"`);
  }
  if (input.worldSetting) {
    const first = input.worldSetting.split(/[.!?]/)[0]?.trim();
    if (first) parts.push(first);
  }
  if (input.sceneObjects && input.sceneObjects.length > 0) {
    parts.push(`${input.sceneObjects.join(", ")} visible in scene`);
  }
  if (input.worldArtStyle) parts.push(input.worldArtStyle);
  if (input.worldColorPalette && input.worldColorPalette.length > 0) {
    parts.push(input.worldColorPalette.join(", "));
  }
  if (input.cameraFraming) parts.push(input.cameraFraming);
  parts.push(`aspect ratio ${input.aspectRatio}`);
  if (input.dialogueLines.length > 0) {
    const lines = input.dialogueLines.map((d) => {
      const quoted = `"${d.text}"`;
      switch (d.type) {
        case "narration": return `narration caption box with text ${quoted}`;
        case "thought":  return `thought bubble near ${d.speaker} with text ${quoted}`;
        case "sfx":      return `bold sound-effect text ${quoted}`;
        default:         return `speech bubble from ${d.speaker} with text ${quoted}`;
      }
    });
    parts.push(`draw comic lettering: ${lines.join(", ")}`);
  }

  const prompt = parts.join(", ") + ".";
  const negativeBase = [
    "no multi-panel page", "no panel grid", "no split frame",
    "bad anatomy", "deformed hands", "extra digits",
    "blurry", "jpeg artifacts", "watermark",
  ];
  if (input.worldArtStyleNegative && input.worldArtStyleNegative.length > 0) {
    negativeBase.push(...input.worldArtStyleNegative);
  }
  const negativePrompt = negativeBase.join(", ");
  return { prompt, negativePrompt };
}

/**
 * Optimize a panel's text-to-image prompt via an LLM.
 *
 * On error, falls back to a simple deterministic concatenation so the caller
 * is never blocked.
 */
export async function optimizePanelPrompt(
  input: OptimizePanelPromptInput,
  model: LanguageModel,
): Promise<OptimizePanelPromptResult> {
  const userPrompt = `Optimize this comic panel context into a text-to-image prompt.\n\n${JSON.stringify(input, null, 2)}`;

  try {
    const result = await generateText({
      model: model as LanguageModelV1,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.4,
    });

    const text = result.text.trim();
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

    let prompt = "";
    let negativePrompt = "";
    if (lines.length >= 2) {
      prompt = lines[0]!;
      const negLine = lines.find((l) => /^NEGATIVE:/i.test(l));
      negativePrompt = negLine ? negLine.replace(/^NEGATIVE:\s*/i, "").trim() : lines[1]!;
    } else if (lines.length === 1) {
      prompt = lines[0]!;
    }

    if (prompt.length === 0) {
      log.warn("LLM returned empty prompt, using fallback");
      return fallbackPrompt(input);
    }
    if (negativePrompt.length === 0) {
      negativePrompt =
        "no multi-panel page, no panel grid, no split frame, bad anatomy, deformed hands, extra digits, blurry, jpeg artifacts, watermark";
    }

    log.info("Panel prompt optimized", {
      promptLen: prompt.length,
      negativeLen: negativePrompt.length,
      charCount: input.characters.length,
    });
    return { prompt, negativePrompt };
  } catch (e) {
    log.warn("Panel prompt optimization failed, using fallback", {
      error: e instanceof Error ? e.message : String(e),
    });
    return fallbackPrompt(input);
  }
}
