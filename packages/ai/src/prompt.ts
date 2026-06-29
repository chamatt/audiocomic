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
  wide: "wide establishing shot showing the full environment",
  medium: "medium shot framing the character(s) from the waist up",
  "close-up": "close-up shot focusing on the character's face and expression",
  "extreme-close-up": "extreme close-up on a specific detail (eyes, hand, object)",
  overhead: "overhead top-down shot looking down at the scene",
  "low-angle": "low-angle shot looking up at the character(s), making them imposing",
  pov: "first-person POV shot from a character's perspective",
  establishing: "wide establishing shot showing the location and spatial layout",
};

/** Map abstract emotional tones to concrete visual cues the renderer can draw. */
const TONE_VISUAL: Record<string, string> = {
  neutral: "",
  tense: "tense atmosphere: tight body language, narrowed eyes, clenched fists, sharp shadows",
  joyful: "joyful energy: bright eyes, wide smiles, dynamic posing, warm lighting",
  sad: "sadness: downcast eyes, slumped posture, muted colors, rain or tears",
  angry: "anger: furrowed brow, gritted teeth, clenched fists, harsh red lighting",
  fearful: "fear: wide eyes, trembling, recoiling posture, dark oppressive shadows",
  romantic: "romantic mood: soft focus, warm golden light, gentle expressions, blush",
  mysterious: "mystery: heavy shadows, fog, obscured faces, cool blue tones",
  epic: "epic scale: dramatic perspective, sweeping vista, intense lighting from above",
  comedic: "comedy: exaggerated expressions, dynamic poses, bright colors, motion lines",
  melancholic: "melancholy: distant gaze, somber expression, fading light, autumn tones",
  hopeful: "hope: upward gaze, soft warm light breaking through, gentle smile",
};

/**
 * Compose a single text-to-image render prompt for a panel.
 *
 * Prompt ordering is deliberate: image models weight early tokens more
 * heavily, so we put the most important visual elements (characters in
 * action, emotional expression) first, then environment, then metadata.
 *
 * Structure:
 *   1. Art style + color palette (sets the visual register)
 *   2. Characters in action (who + what they're doing + expression)
 *   3. Panel description (the specific visual moment)
 *   4. Visual tone cues (concrete, not abstract labels)
 *   5. Key objects described visually (placed in the scene)
 *   6. Camera framing
 *   7. Panel layout (aspect ratio)
 *   8. Continuity context (world/scene/beat — background knowledge)
 *   9. Speech bubble space
 */
export function composePanelPrompt(
  panel: PanelSpec,
  section: StorySection,
  characterRefs: CharacterProfile[],
  worldBible: WorldBible,
  sectionMemoryOrAllSections?: string | StorySection[],
): string {
  const parts: string[] = [];
  // ── 0. Single-panel framing — prevent the model from generating a full comic page ──
  parts.push("SINGLE COMIC PANEL — one isolated illustration, NOT a full comic page. No panel grid, no multiple panels, no page layout. Just one single frame image.");

  if (worldBible.artStyle) {
    // Strip page-level direction that causes the model to generate
    // multi-panel comic pages instead of a single panel image.
    const singlePanelArtStyle = worldBible.artStyle
      .replace(/panel-to-panel[^.]*\./gi, "")
      .replace(/smooth panel[^.]*\./gi, "")
      .replace(/reaction-panel[^.]*\./gi, "")
      .replace(/establishing shots?/gi, "establishing shot")
      .trim();
    parts.push(`Art style: ${singlePanelArtStyle}.`);
  }
  if (worldBible.colorPalette.length > 0) {
    parts.push(`Color palette: ${worldBible.colorPalette.join(", ")}.`);
  }

  // ── 2. Characters in action (front-loaded — most important) ──
  const refsById = new Map(characterRefs.map((c) => [c.id, c]));
  const charBlocks: string[] = [];
  for (const slot of panel.characters) {
    const profile = refsById.get(slot.characterId);
    if (!profile) continue;
    const bits: string[] = [];
    if (profile.description) {
      bits.push(profile.description);
    }
    bits.push(profile.name);
    if (slot.expression) bits.push(`expression: ${slot.expression}`);
    if (slot.pose) bits.push(`pose: ${slot.pose}`);
    if (slot.position) bits.push(`position: ${slot.position} of frame`);
    if (profile.paletteNotes.length > 0) {
      bits.push(`colors: ${profile.paletteNotes.join(", ")}`);
    }
    charBlocks.push(bits.join("; "));
  }
  if (charBlocks.length > 0) {
    parts.push(`Characters in this panel:\n${charBlocks.map((b) => `  - ${b}`).join("\n")}`);
  }

  // ── 3. Panel visual description (the specific moment) ──
  parts.push(`Scene: ${panel.description}`);

  // ── 4. Visual tone cues (concrete, not abstract) ──
  const tone = section.emotionalTone;
  if (tone && tone !== "neutral" && TONE_VISUAL[tone]) {
    parts.push(TONE_VISUAL[tone]!);
  }
  if (worldBible.tone && worldBible.tone !== "neutral") {
    const worldToneVisual = TONE_VISUAL[worldBible.tone];
    if (worldToneVisual) parts.push(worldToneVisual);
  }

  // ── 5. Key objects described visually (placed in the scene) ──
  if (section.objects.length > 0) {
    const objectDescs = section.objects.map((obj) => `${obj} visible in the scene`);
    parts.push(`Key objects to include: ${objectDescs.join("; ")}.`);
  }

  // ── 6. Camera framing ──
  const camera = panel.cameraFraming ?? section.cameraHint;
  if (camera && CAMERA_LABEL[camera]) {
    parts.push(`Camera: ${CAMERA_LABEL[camera]}.`);
  }

  // ── 7. Panel layout (aspect ratio) ──
  const aspect = panel.bbox.w / panel.bbox.h;
  if (aspect > 1.3) {
    parts.push(`Panel shape: wide horizontal panel (aspect ~${aspect.toFixed(1)}:1).`);
  } else if (aspect < 0.77) {
    parts.push(`Panel shape: tall vertical panel (aspect ~1:${(1 / aspect).toFixed(1)}).`);
  } else {
    parts.push(`Panel shape: roughly square panel.`);
  }

  // ── 8. Continuity context (background knowledge, less weighted) ──
  let memoryStr: string | undefined;
  if (Array.isArray(sectionMemoryOrAllSections)) {
    memoryStr = buildSectionMemory(section, sectionMemoryOrAllSections, characterRefs, worldBible);
  } else {
    memoryStr = sectionMemoryOrAllSections;
  }
  if (memoryStr && memoryStr.trim().length > 0) {
    parts.push(`Continuity context (background):\n${memoryStr.trim()}`);
  }

  // ── 9. Speech bubble space ──
  if (panel.dialogueLines.length > 0) {
    const lines = panel.dialogueLines.map((l) => `${l.speaker} (${l.type}): "${l.text}"`);
    parts.push(`Leave space for speech bubbles: ${lines.join(" ; ")}`);
  }

  return parts.join("\n\n");
}

/**
 * Compose a negative prompt for a panel — things to avoid in the generated image.
 */
export function composeNegativePrompt(
  panel: PanelSpec,
  characterRefs: CharacterProfile[],
  worldBible: WorldBible,
): string {
  const negatives: string[] = [
    ...worldBible.artStyleNegative,
    ...characterRefs.flatMap((c) => c.negativeConstraints),
  ];

  negatives.push("no comic page layout", "no multiple panels", "no panel grid", "no gibberish text", "no watermarks", "no extra borders");
  const hasHuman = panel.characters.some((slot) => {
    const profile = characterRefs.find((c) => c.id === slot.characterId);
    return profile?.description?.toLowerCase().includes("human");
  });
  if (!hasHuman && panel.characters.length > 0) {
    negatives.push("no human characters");
  }


  return negatives.join(", ");
}
