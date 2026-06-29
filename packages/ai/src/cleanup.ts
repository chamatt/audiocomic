/**
 * Character description cleanup.
 *
 * When characters are merged or accumulated across chapters, their descriptions
 * often contain duplicate or overlapping information. This module uses the LLM
 * to consolidate a description (or two descriptions) into a single, clean,
 * non-redundant paragraph.
 */

import { generateText, type LanguageModelV1 } from "ai";
import { logger } from "@audiocomic/shared";

const log = logger.scoped("ai:cleanup");

const CLEANUP_PROMPT = `You are a character description editor for a comic book production tool.

You will receive a character description that may contain duplicate, overlapping, or redundant information (because it was accumulated from multiple chapters or merged from duplicate character entries).

Your job:
1. Remove duplicate sentences and redundant information
2. Keep ALL unique visual details — species, body type, clothing, colors, distinctive features, accessories
3. Keep the most specific/version of each detail (e.g. "Level 13 Compensated Anarchist Primal" beats "an adventurer")
4. Merge overlapping sentences into single coherent statements
5. Preserve the reading order: physical appearance → clothing → accessories → current state
6. Output a single paragraph, no bullet points, no headers

Output ONLY the cleaned description text, nothing else.`;

/**
 * Clean up a single character description by removing duplicate info.
 */
export async function cleanupDescription(
  description: string,
  model: LanguageModelV1,
): Promise<string> {
  if (description.length < 50) return description;

  try {
    const result = await generateText({
      model,
      system: CLEANUP_PROMPT,
      prompt: `Clean up this character description. Remove duplicates and redundant info, keep all unique visual details:\n\n${description}`,
      temperature: 0.3,
    });
    const cleaned = result.text.trim();
    if (cleaned.length === 0) return description;
    log.info("Description cleaned", {
      inputLen: description.length,
      outputLen: cleaned.length,
    });
    return cleaned;
  } catch (e) {
    log.warn("Description cleanup failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return description;
  }
}

/**
 * Merge two character descriptions into one clean, non-redundant paragraph.
 */
export async function mergeDescriptions(
  desc1: string,
  desc2: string,
  model: LanguageModelV1,
): Promise<string> {
  if (!desc1) return desc2;
  if (!desc2) return desc1;
  if (desc1 === desc2) return desc1;

  try {
    const result = await generateText({
      model,
      system: CLEANUP_PROMPT,
      prompt: `Merge these two descriptions of the same character into one clean paragraph. Remove all duplicate info, keep all unique visual details from both:\n\nDescription A:\n${desc1}\n\nDescription B:\n${desc2}`,
      temperature: 0.3,
    });
    const merged = result.text.trim();
    if (merged.length === 0) return desc1.length >= desc2.length ? desc1 : desc2;
    log.info("Descriptions merged", {
      len1: desc1.length,
      len2: desc2.length,
      outputLen: merged.length,
    });
    return merged;
  } catch (e) {
    log.warn("Description merge failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    // Fall back to keeping the longer one
    return desc1.length >= desc2.length ? desc1 : desc2;
  }
}
