import type {
  PanelSpec,
  StorySection,
  CharacterProfile,
  WorldBible,
  CameraFraming,
  BoundingBox,
} from "@audiocomic/domain";

// ============================================================================
// Section memory builder — MangaFlow M_k = (d_k, R_scene, R_char, R_obj, φ)
// Traverses beat → parent scene → parent chapter, accumulating context.
// ============================================================================

/**
 * Build a MangaFlow-style section memory string for a beat section.
 * Traverses the parent chain (beat → scene → chapter) to accumulate
 * narrative context, characters, objects, and emotional tone.
 *
 * @param beatSection - The beat-level StorySection the panel belongs to
 * @param allSections - All sections in the project (for parent lookup)
 * @param characters  - All character profiles (for description lookup)
 * @param worldBible   - World bible for setting/art style context
 * @returns A compact string encoding the section memory M_k
 */
export function buildSectionMemory(
  beatSection: StorySection,
  allSections: StorySection[],
  characters: CharacterProfile[],
  worldBible: WorldBible,
): string {
  const sectionById = new Map(allSections.map((s) => [s.id, s]));
  const charById = new Map(characters.map((c) => [c.id, c]));

  // Walk the parent chain: beat → scene → chapter
  const chain: StorySection[] = [beatSection];
  let current: StorySection | undefined = beatSection;
  while (current?.parentId) {
    const parent = sectionById.get(current.parentId);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }

  const lines: string[] = [];

  // World setting (φ component)
  if (worldBible.setting) {
    lines.push(`World: ${worldBible.setting}`);
  }

  // Walk chain from chapter down to beat
  for (const sec of chain) {
    const label = sec.level === "chapter" ? "Chapter" : sec.level === "scene" ? "Scene" : "Beat";
    if (sec.title) {
      lines.push(`${label}: ${sec.title} — ${sec.summary}`);
    } else {
      lines.push(`${label}: ${sec.summary}`);
    }
    if (sec.emotionalTone !== "neutral") {
      lines.push(`  tone: ${sec.emotionalTone}`);
    }
    // Characters present in this section (R_char component)
    if (sec.charactersPresent.length > 0) {
      const charNames = sec.charactersPresent
        .map((id) => charById.get(id)?.name)
        .filter((n): n is string => n !== undefined);
      if (charNames.length > 0) {
        lines.push(`  characters: ${charNames.join(", ")}`);
      }
    }
    // Objects (R_obj component)
    if (sec.objects.length > 0) {
      lines.push(`  objects: ${sec.objects.join(", ")}`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Panel prompt composer — pure function
// ============================================================================

const CAMERA_LABEL: Record<CameraFraming, string> = {
  wide: "wide establishing shot",
  medium: "medium shot",
  "close-up": "close-up shot",
  "extreme-close-up": "extreme close-up shot",
  overhead: "overhead/top-down shot",
  "low-angle": "low-angle shot",
  pov: "point-of-view shot",
  establishing: "establishing shot",
};

/**
 * Compose a single text-to-image render prompt for a panel by combining:
 *  - the world bible art style / palette / negative constraints
 *  - section memory (MangaFlow M_k: traverses beat → scene → chapter)
 *  - layout context (panel aspect ratio from bbox)
 *  - the panel's own visual description and camera framing
 *  - the characters appearing in the panel (with visual references)
 *  - key objects from the section
 *  - dialogue/narration lines (so the model leaves composition room)
 *
 * This is a pure, side-effect-free function.
 *
 * @param sectionMemoryOrAllSections - Either a pre-built memory string (legacy),
 *        or all story sections for parent traversal. If sections are passed,
 *        buildSectionMemory is called to build structured M_k.
 */
export function composePanelPrompt(
  panel: PanelSpec,
  section: StorySection,
  characterRefs: CharacterProfile[],
  worldBible: WorldBible,
  sectionMemoryOrAllSections?: string | StorySection[],
): string {
  const parts: string[] = [];

  // --- Art direction from the world bible ---
  if (worldBible.artStyle) {
    parts.push(`Art style: ${worldBible.artStyle}.`);
  }
  if (worldBible.colorPalette.length > 0) {
    parts.push(`Color palette: ${worldBible.colorPalette.join(", ")}.`);
  }
  if (worldBible.tone) {
    parts.push(`Overall tone: ${worldBible.tone}.`);
  }

  // --- Section memory (MangaFlow M_k) ---
  let memoryStr: string | undefined;
  if (Array.isArray(sectionMemoryOrAllSections)) {
    memoryStr = buildSectionMemory(section, sectionMemoryOrAllSections, characterRefs, worldBible);
  } else {
    memoryStr = sectionMemoryOrAllSections;
  }
  if (memoryStr && memoryStr.trim().length > 0) {
    parts.push(`Continuity context:\n${memoryStr.trim()}`);
  }

  // --- Layout context (panel bbox aspect ratio — MangaFlow L̃_i) ---
  const aspect = panel.bbox.w / panel.bbox.h;
  if (aspect > 1.3) {
    parts.push(`Panel layout: wide horizontal panel (aspect ~${aspect.toFixed(1)}:1).`);
  } else if (aspect < 0.77) {
    parts.push(`Panel layout: tall vertical panel (aspect ~1:${(1 / aspect).toFixed(1)}).`);
  } else {
    parts.push(`Panel layout: roughly square panel.`);
  }

  // --- Scene / beat summary ---
  const sectionLabel =
    section.level === "beat" ? "Beat" : section.level === "scene" ? "Scene" : "Chapter";
  parts.push(`${sectionLabel} summary: ${section.summary}`);
  if (section.emotionalTone !== "neutral") {
    parts.push(`Emotional tone: ${section.emotionalTone}.`);
  }

  // --- Key objects from the section (MangaFlow O_k) ---
  if (section.objects.length > 0) {
    parts.push(`Key objects: ${section.objects.join(", ")}.`);
  }

  // --- Camera framing (panel override wins) ---
  const camera = panel.cameraFraming ?? section.cameraHint;
  if (camera) {
    parts.push(`Framing: ${CAMERA_LABEL[camera]}.`);
  }

  // --- Panel visual description ---
  parts.push(`Panel description: ${panel.description}`);

  // --- Characters present (with visual references — MangaFlow R_char) ---
  const refsById = new Map(characterRefs.map((c) => [c.id, c]));
  const charBlocks: string[] = [];
  for (const slot of panel.characters) {
    const profile = refsById.get(slot.characterId);
    if (!profile) continue;
    const bits: string[] = [profile.name];
    if (profile.description) bits.push(profile.description);
    if (slot.expression) bits.push(`expression: ${slot.expression}`);
    if (slot.pose) bits.push(`pose: ${slot.pose}`);
    if (slot.position) bits.push(`placed ${slot.position}`);
    if (profile.paletteNotes.length > 0) {
      bits.push(`palette: ${profile.paletteNotes.join(", ")}`);
    }
    if (profile.canonicalFaceRef) {
      bits.push(`face ref: ${profile.canonicalFaceRef}`);
    }
    if (profile.outfitRefs.length > 0) {
      bits.push(`outfit refs: ${profile.outfitRefs.join(", ")}`);
    }
    charBlocks.push(bits.join("; "));
  }
  if (charBlocks.length > 0) {
    parts.push(`Characters: ${charBlocks.join(" | ")}`);
  }

  // --- Dialogue / narration (composition guidance, not rendered text) ---
  if (panel.dialogueLines.length > 0) {
    const lines = panel.dialogueLines.map((l) => `${l.speaker} (${l.type}): "${l.text}"`);
    parts.push(`Leave speech-bubble/narration space for: ${lines.join(" ; ")}`);
  }

  // --- Negative constraints ---
  const negatives = [
    ...worldBible.artStyleNegative,
    ...characterRefs.flatMap((c) => c.negativeConstraints),
  ];
  if (negatives.length > 0) {
    parts.push(`Avoid: ${negatives.join(", ")}`);
  }

  return parts.join("\n");
}
