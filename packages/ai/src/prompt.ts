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
  // ── Master formula: [Framing] of [Subject+Action], [Setting], [Style], [Technical] ──
  // Visual-first, comma-separated keywords. No narrative prose.
  // See: single-panel prompting research (June 2026).

  const refsById = new Map(characterRefs.map((c) => [c.id, c]));
  // Pixel-space aspect ratio (bbox is normalized to a non-square page)
  const PAGE_W = 800, PAGE_H = 1131;
  const aspect = (panel.bbox.w * PAGE_W) / (panel.bbox.h * PAGE_H);

  // ── 1. Framing constraint (always first — highest weight) ──
  const framing = "A single illustration of one scene showing";

  // ── 2. Subject and action (visual, not narrative) ──
  const charBlocks: string[] = [];
  for (const slot of panel.characters) {
    const profile = refsById.get(slot.characterId);
    if (!profile) continue;
    const bits: string[] = [];
    if (profile.description) bits.push(profile.description);
    if (slot.pose) bits.push(slot.pose);
    if (slot.expression) bits.push(`${slot.expression} expression`);
    if (slot.position) bits.push(`positioned ${slot.position} of frame`);
    if (profile.paletteNotes.length > 0) {
      bits.push(`colors: ${profile.paletteNotes.join(", ")}`);
    }
    charBlocks.push(bits.join(", "));
  }
  const subjectParts: string[] = [];
  if (charBlocks.length > 0) {
    subjectParts.push(charBlocks.join("; "));
  }
  // Panel description is the action — strip narrative prefixes
  const action = panel.description
    .replace(/^(A clear visual beat:?|The scene shows:?|We see:?)/gi, "")
    .trim();
  subjectParts.push(action);
  const subject = subjectParts.join(", ");

  // ── 3. Setting / background (keep minimal — long settings cause multi-panel) ──
  const settingParts: string[] = [];
  if (worldBible.setting) {
    // Truncate setting to first sentence — image models interpret long
    // world descriptions as instructions to show multiple scenes
    const firstSentence = worldBible.setting.split(/[.!?]/)[0]?.trim() ?? "";
    if (firstSentence) settingParts.push(firstSentence);
  }
  if (section.objects.length > 0) {
    settingParts.push(`${section.objects.join(", ")} visible in scene`);
  }
  // NOTE: Continuity context (section memory) is intentionally omitted from
  // the image prompt. It causes the model to generate multi-panel pages
  // because it describes multiple scenes/chapters. Continuity is handled
  // by the planner agents, not the image renderer.
  const setting = settingParts.join(", ");

  // ── 4. Style modifiers ──
  const styleParts: string[] = [];
  if (worldBible.artStyle) {
    // Strip page-level direction that causes multi-panel generation
    const cleanStyle = worldBible.artStyle
      .replace(/panel-to-panel[^.]*\./gi, "")
      .replace(/smooth panel[^.]*\./gi, "")
      .replace(/reaction-panel[^.]*\./gi, "")
      .replace(/split-panel[^.]*\./gi, "")
      .replace(/multi-panel[^.]*\./gi, "")
      .replace(/establishing shots?/gi, "establishing shot")
      .trim();
    styleParts.push(cleanStyle);
  }
  if (worldBible.colorPalette.length > 0) {
    styleParts.push(worldBible.colorPalette.join(", "));
  }
  // Visual tone cues
  const tone = section.emotionalTone;
  if (tone && tone !== "neutral" && TONE_VISUAL[tone]) {
    styleParts.push(TONE_VISUAL[tone]!);
  }
  if (worldBible.tone && worldBible.tone !== "neutral") {
    const worldToneVisual = TONE_VISUAL[worldBible.tone];
    if (worldToneVisual) styleParts.push(worldToneVisual);
  }
  const style = styleParts.join(", ");

  // ── 5. Technical framing / ratio ──
  const techParts: string[] = [];
  const camera = panel.cameraFraming ?? section.cameraHint;
  if (camera && CAMERA_LABEL[camera]) {
    techParts.push(CAMERA_LABEL[camera]!);
  }
  // Express aspect ratio explicitly
  if (aspect > 1.3) {
    techParts.push(`wide horizontal panel, aspect ratio ${aspect.toFixed(1)}:1`);
  } else if (aspect < 0.77) {
    techParts.push(`tall vertical panel, aspect ratio 1:${(1 / aspect).toFixed(1)}`);
  } else {
    techParts.push("roughly square panel, aspect ratio 1:1");
  }
  // Reserve space for dialogue bubbles — do NOT include the actual text,
  // image models will render it literally into the image.
  if (panel.dialogueLines.length > 0) {
    techParts.push("leave empty space in upper area for speech bubbles, do not draw any text or letters");
  }
  const tech = techParts.join(", ");

  // ── Assemble: [Framing] of [Subject], [Setting], [Style], [Technical] ──
  // ── Assemble: [Framing] [Subject], [Setting], [Style], [Technical] ──
  // Framing + subject joined with space (no comma), rest with commas
  const rest: string[] = [];
  if (setting) rest.push(setting);
  if (style) rest.push(style);
  if (tech) rest.push(tech);
  const result = rest.length > 0
    ? `${framing} ${subject}, ${rest.join(", ")}.`
    : `${framing} ${subject}.`;
  return result;
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

  negatives.push("no comic page", "no page layout", "no multiple panels", "no panel grid", "no panel borders", "no divided layout", "no split frame", "no gibberish text", "no watermarks", "no extra borders");
  const hasHuman = panel.characters.some((slot) => {
    const profile = characterRefs.find((c) => c.id === slot.characterId);
    return profile?.description?.toLowerCase().includes("human");
  });
  if (!hasHuman && panel.characters.length > 0) {
    negatives.push("no human characters");
  }


  return negatives.join(", ");
}
