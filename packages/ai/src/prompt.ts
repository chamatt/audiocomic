import type {
  PanelSpec,
  StorySection,
  CharacterProfile,
  WorldBible,
  CameraFraming,
} from '@audiocomic/domain';

// ============================================================================
// Panel prompt composer — pure function
// ============================================================================

const CAMERA_LABEL: Record<CameraFraming, string> = {
  wide: 'wide establishing shot',
  medium: 'medium shot',
  'close-up': 'close-up shot',
  'extreme-close-up': 'extreme close-up shot',
  overhead: 'overhead/top-down shot',
  'low-angle': 'low-angle shot',
  pov: 'point-of-view shot',
  establishing: 'establishing shot',
};

/**
 * Compose a single text-to-image render prompt for a panel by combining:
 *  - the world bible art style / palette / negative constraints
 *  - the beat/scene summary and section memory (MangaFlow-style context)
 *  - the panel's own visual description and camera framing
 *  - the characters appearing in the panel (resolved against character refs)
 *  - dialogue/narration lines (so the model leaves composition room)
 *
 * This is a pure, side-effect-free function.
 */
export function composePanelPrompt(
  panel: PanelSpec,
  section: StorySection,
  characterRefs: CharacterProfile[],
  worldBible: WorldBible,
  sectionMemory?: string,
): string {
  const parts: string[] = [];

  // --- Art direction from the world bible ---
  if (worldBible.artStyle) {
    parts.push(`Art style: ${worldBible.artStyle}.`);
  }
  if (worldBible.colorPalette.length > 0) {
    parts.push(`Color palette: ${worldBible.colorPalette.join(', ')}.`);
  }
  if (worldBible.tone) {
    parts.push(`Overall tone: ${worldBible.tone}.`);
  }

  // --- Section memory (prior context for consistency) ---
  if (sectionMemory && sectionMemory.trim().length > 0) {
    parts.push(`Continuity context: ${sectionMemory.trim()}`);
  }

  // --- Scene / beat summary ---
  const sectionLabel =
    section.level === 'beat'
      ? 'Beat'
      : section.level === 'scene'
        ? 'Scene'
        : 'Chapter';
  parts.push(`${sectionLabel} summary: ${section.summary}`);
  if (section.emotionalTone !== 'neutral') {
    parts.push(`Emotional tone: ${section.emotionalTone}.`);
  }

  // --- Camera framing (panel override wins) ---
  const camera = panel.cameraFraming ?? section.cameraHint;
  if (camera) {
    parts.push(`Framing: ${CAMERA_LABEL[camera]}.`);
  }

  // --- Panel visual description ---
  parts.push(`Panel description: ${panel.description}`);

  // --- Characters present ---
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
      bits.push(`palette: ${profile.paletteNotes.join(', ')}`);
    }
    charBlocks.push(bits.join('; '));
  }
  if (charBlocks.length > 0) {
    parts.push(`Characters: ${charBlocks.join(' | ')}`);
  }

  // --- Dialogue / narration (composition guidance, not rendered text) ---
  if (panel.dialogueLines.length > 0) {
    const lines = panel.dialogueLines.map(
      (l) => `${l.speaker} (${l.type}): "${l.text}"`,
    );
    parts.push(
      `Leave speech-bubble/narration space for: ${lines.join(' ; ')}`,
    );
  }

  // --- Negative constraints ---
  const negatives = [
    ...worldBible.artStyleNegative,
    ...characterRefs.flatMap((c) => c.negativeConstraints),
  ];
  if (negatives.length > 0) {
    parts.push(`Avoid: ${negatives.join(', ')}`);
  }

  return parts.join('\n');
}
