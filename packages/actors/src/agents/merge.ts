/**
 * Character deduplication and merging.
 *
 * When the story planner generates characters for a new chapter, it creates
 * fresh UUIDs for every character — even if "Carl" already exists from
 * chapter 1. This module matches planner-generated characters against the
 * existing project roster by name/alias, reuses existing IDs, and merges
 * new information (aliases, description, role) into the existing record.
 *
 * It also remaps character IDs in StorySection.charactersPresent so that
 * panels created from those beats reference the correct existing character.
 */

import type { CharacterProfile, StorySection } from "@audiocomic/domain";
import type { Repository } from "@audiocomic/db";
import { logger } from "@audiocomic/shared";
import { mergeDescriptions, cleanupDescription, type LanguageModel } from "@audiocomic/ai";

const log = logger.scoped("merge:characters");

const ROLE_PRIORITY: Record<string, number> = {
  protagonist: 5,
  antagonist: 4,
  supporting: 3,
  minor: 2,
  narrator: 1,
};

function normaliseName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Find an existing character that matches by name or alias (case-insensitive).
 */
function findExisting(
  existing: CharacterProfile[],
  name: string,
  aliases: string[],
): CharacterProfile | undefined {
  const target = normaliseName(name);
  return existing.find(
    (c) =>
      normaliseName(c.name) === target ||
      c.aliases.some((a) => normaliseName(a) === target) ||
      aliases.some((a) => normaliseName(a) === normaliseName(c.name)) ||
      c.aliases.some((a) => aliases.some((na) => normaliseName(a) === normaliseName(na))),
  );
}

/**
 * Merge two character profiles, preferring the more detailed/newer info.
 *
 * - Description: keep the longer one (more visual detail)
 * - Aliases: union of both
 * - Role: keep the higher-priority one
 * - Visual anchors (canonicalFaceRef, outfitRefs, etc.): keep existing if set
 */
function mergeProfile(
  existing: CharacterProfile,
  incoming: CharacterProfile,
): Partial<CharacterProfile> {
  const patch: Partial<CharacterProfile> = {};

  // Merge aliases (union, case-insensitive dedup)
  const aliasSet = new Set(existing.aliases.map(normaliseName));
  const newAliases = [...existing.aliases];
  for (const a of incoming.aliases) {
    if (!aliasSet.has(normaliseName(a))) {
      newAliases.push(a);
      aliasSet.add(normaliseName(a));
    }
  }
  if (newAliases.length !== existing.aliases.length) {
    patch.aliases = newAliases;
  }

  // Keep longer description (more visual detail)
  if ((incoming.description?.length ?? 0) > (existing.description?.length ?? 0)) {
    patch.description = incoming.description;
  }

  // Keep higher-priority role
  const existingPriority = ROLE_PRIORITY[existing.role] ?? 0;
  const incomingPriority = ROLE_PRIORITY[incoming.role] ?? 0;
  if (incomingPriority > existingPriority) {
    patch.role = incoming.role;
  }

  // Merge palette notes (union)
  if (incoming.paletteNotes?.length) {
    const noteSet = new Set(existing.paletteNotes);
    const newNotes = [...existing.paletteNotes];
    for (const n of incoming.paletteNotes) {
      if (!noteSet.has(n)) {
        newNotes.push(n);
        noteSet.add(n);
      }
    }
    if (newNotes.length !== existing.paletteNotes.length) {
      patch.paletteNotes = newNotes;
    }
  }

  // Merge negative constraints (union)
  if (incoming.negativeConstraints?.length) {
    const conSet = new Set(existing.negativeConstraints);
    const newCons = [...existing.negativeConstraints];
    for (const c of incoming.negativeConstraints) {
      if (!conSet.has(c)) {
        newCons.push(c);
        conSet.add(c);
      }
    }
    if (newCons.length !== existing.negativeConstraints.length) {
      patch.negativeConstraints = newCons;
    }
  }

  return patch;
}

export interface MergeResult {
  /** Final character list: existing (patched) + new characters */
  characters: CharacterProfile[];
  /** Sections with remapped charactersPresent */
  sections: StorySection[];
  /** Map of incoming ID → existing ID (for characters that matched) */
  idRemap: Map<string, string>;
  /** Number of characters matched to existing */
  matched: number;
  /** Number of new characters created */
  created: number;
}

/**
 * Deduplicate planner-generated characters against the existing project roster.
 *
 * - Characters matching by name/alias are merged into the existing record
 *   (aliases, description, role are merged; visual anchors are preserved).
 * - New characters are kept as-is (will be created by the caller).
 * - StorySection.charactersPresent arrays are remapped to use existing IDs.
 *
 * The caller is responsible for persisting the returned characters and sections.
 * Matched characters are patched in the DB by this function.
 */
export async function mergeCharacters(
  newCharacters: CharacterProfile[],
  sections: StorySection[],
  repo: Repository,
  projectId: string,
): Promise<MergeResult> {
  const existing = await repo.characterProfiles.getByProjectId(projectId);

  const idRemap = new Map<string, string>();
  const finalCharacters: CharacterProfile[] = [];
  let matched = 0;
  let created = 0;

  for (const incoming of newCharacters) {
    const match = findExisting(existing, incoming.name, incoming.aliases);

    if (match) {
      // Reuse existing ID
      idRemap.set(incoming.id, match.id);
      matched++;

      // Merge new info into existing character
      const patch = mergeProfile(match, incoming);
      if (Object.keys(patch).length > 0) {
        try {
          await repo.characterProfiles.patch(match.id, patch);
        } catch (e) {
          log.warn("Failed to patch character during merge", {
            characterId: match.id,
            name: match.name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // Use the merged version for downstream prompt composition
      finalCharacters.push({ ...match, ...patch });
    } else {
      // New character — keep as-is
      created++;
      finalCharacters.push(incoming);
    }
  }

  // Remap charactersPresent in all sections
  const remappedSections = sections.map((s) => {
    if (s.charactersPresent.length === 0) return s;
    const remapped = s.charactersPresent.map((id) => idRemap.get(id) ?? id);
    if (remapped.some((id, i) => id !== s.charactersPresent[i])) {
      return { ...s, charactersPresent: remapped };
    }
    return s;
  });

  log.info("Character merge complete", {
    projectId,
    incoming: newCharacters.length,
    matched,
    created,
    existingRoster: existing.length,
  });

  return {
    characters: finalCharacters,
    sections: remappedSections,
    idRemap,
    matched,
    created,
  };
}

/**
 * Manually merge two characters — used by the UI merge endpoint.
 *
 * The `source` character is merged into the `target` character:
 * - Target keeps its ID
 * - Aliases, description, role, visual anchors are merged
 * - If a language model is provided, descriptions are consolidated via LLM
 *   to remove duplicate info; otherwise the longer description wins
 * - All StorySection.charactersPresent references to source are remapped to target
 * - All PanelSpec.characters[].characterId references to source are remapped to target
 * - All CharacterState references to source are remapped to target
 * - The source character is deleted
 *
 * Returns a summary of what was merged.
 */
export async function mergeTwoCharacters(
  repo: Repository,
  projectId: string,
  sourceId: string,
  targetId: string,
  model?: LanguageModel,
): Promise<{
  sectionsUpdated: number;
  panelsUpdated: number;
  statesUpdated: number;
  aliasesMerged: number;
  descriptionCleaned: boolean;
}> {
  const [source, target] = await Promise.all([
    repo.characterProfiles.getById(sourceId),
    repo.characterProfiles.getById(targetId),
  ]);

  if (!source) throw new Error(`Source character ${sourceId} not found`);
  if (!target) throw new Error(`Target character ${targetId} not found`);
  if (source.projectId !== projectId || target.projectId !== projectId) {
    throw new Error("Characters do not belong to the specified project");
  }

  // Merge source into target
  const patch = mergeProfile(target, source);
  // Also add source's name as an alias of target
  const aliasSet = new Set((patch.aliases ?? target.aliases).map(normaliseName));
  if (!aliasSet.has(normaliseName(source.name))) {
    patch.aliases = [...(patch.aliases ?? target.aliases), source.name];
  }

  // If LLM available, merge descriptions intelligently; otherwise keep longer
  let descriptionCleaned = false;
  if (model && source.description && target.description && source.description !== target.description) {
    try {
      const merged = await mergeDescriptions(target.description, source.description, model);
      if (merged !== target.description) {
        patch.description = merged;
        descriptionCleaned = true;
      }
    } catch (e) {
      log.warn("LLM description merge failed, keeping longer description", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (Object.keys(patch).length > 0) {
    await repo.characterProfiles.patch(targetId, patch);
  }

  // Remap StorySection.charactersPresent
  const sections = await repo.storySections.getByProjectId(projectId);
  let sectionsUpdated = 0;
  for (const s of sections) {
    if (!s.charactersPresent.includes(sourceId)) continue;
    const remapped = s.charactersPresent.map((id) => (id === sourceId ? targetId : id));
    // Deduplicate (source→target may create duplicates if both were present)
    const deduped = [...new Set(remapped)];
    await repo.storySections.patch(s.id, { charactersPresent: deduped });
    sectionsUpdated++;
  }

  // Remap PanelSpec.characters[].characterId
  const panels = await repo.panelSpecs.getByProjectId(projectId);
  let panelsUpdated = 0;
  for (const p of panels) {
    if (!p.characters.some((c) => c.characterId === sourceId)) continue;
    const remapped = p.characters.map((c) =>
      c.characterId === sourceId ? { ...c, characterId: targetId } : c,
    );
    // Deduplicate by characterId (keep first occurrence)
    const seen = new Set<string>();
    const deduped = remapped.filter((c) => {
      if (seen.has(c.characterId)) return false;
      seen.add(c.characterId);
      return true;
    });
    await repo.panelSpecs.patch(p.id, { characters: deduped });
    panelsUpdated++;
  }

  // Remap CharacterState.characterId
  const states = await repo.characterStates.getByProjectId(projectId);
  let statesUpdated = 0;
  for (const cs of states) {
    if (cs.characterId !== sourceId) continue;
    await repo.characterStates.patch(cs.id, { characterId: targetId });
    statesUpdated++;
  }

  // Delete the source character
  await repo.characterProfiles.delete(sourceId);

  const aliasesMerged = patch.aliases
    ? patch.aliases.length - target.aliases.length
    : 0;

  log.info("Manual character merge", {
    projectId,
    sourceName: source.name,
    targetName: target.name,
    sectionsUpdated,
    panelsUpdated,
    statesUpdated,
    descriptionCleaned,
  });

  return { sectionsUpdated, panelsUpdated, statesUpdated, aliasesMerged, descriptionCleaned };
}

/**
 * Clean up a single character's description using the LLM.
 * Removes duplicate/redundant info accumulated from multiple chapters.
 */
export async function cleanupCharacterDescription(
  repo: Repository,
  characterId: string,
  model: LanguageModel,
): Promise<{ cleaned: boolean; oldLength: number; newLength: number }> {
  const char = await repo.characterProfiles.getById(characterId);
  if (!char) throw new Error(`Character ${characterId} not found`);

  const cleaned = await cleanupDescription(char.description, model);
  if (cleaned === char.description) {
    return { cleaned: false, oldLength: char.description.length, newLength: char.description.length };
  }

  await repo.characterProfiles.patch(characterId, { description: cleaned });
  log.info("Description cleaned", { characterId, name: char.name });
  return { cleaned: true, oldLength: char.description.length, newLength: cleaned.length };
}
