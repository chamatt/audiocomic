// Filename → chapter title parser.
//
// Strips the file extension, leading chapter-numbering prefixes (e.g.
// `01 `, `001-`, `chapter_01_`, `Chapter 1 - `), normalizes `_`/`-` to
// spaces, trims, and converts to Title Case.
//
// Examples:
//   chapter_01_the_arrival.m4b      → "The Arrival"
//   Chapter 1 - The Arrival.m4b     → "The Arrival"
//   01 The Arrival.m4b              → "The Arrival"
//   the_arrival.m4b                 → "The Arrival"
//   Carl's Doomsday Scenario.m4b    → "Carl's Doomsday Scenario"

// Matches a leading `chapter` keyword followed by optional separators, a
// number, and trailing separators — case-insensitive. e.g. `chapter_01_`,
// `Chapter 1 - `, `chapter 01 - `.
const LEADING_CHAPTER_RE = /^chapter[\s_-]*\d+[\s_-]*/i;

// Matches a leading bare number followed by separators. e.g. `01 `, `001-`.
const LEADING_NUMBER_RE = /^\d+[\s_-]+/;

// Matches a file extension at the end of the filename. e.g. `.m4b`, `.mp3`.
const EXT_RE = /\.[^.]+$/;

function toTitleCase(word: string): string {
  if (word.length === 0) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Parse an audio filename into a human-readable chapter title.
 *
 * Falls back to `"Chapter"` when the filename yields no usable text after
 * stripping (e.g. `01.m4b`).
 */
export function parseChapterTitle(filename: string): string {
  // 1. Strip the file extension.
  let name = filename.replace(EXT_RE, '');

  // 2. Strip leading chapter/number prefixes. Apply repeatedly so compound
  //    prefixes like `01_chapter_02_` collapse fully.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const before = name;
    name = name.replace(LEADING_CHAPTER_RE, '').replace(LEADING_NUMBER_RE, '');
    if (name === before) break;
  }

  // 3. Replace `_` and `-` with spaces.
  name = name.replace(/[_-]+/g, ' ');

  // 4. Collapse repeated whitespace and trim.
  name = name.replace(/\s+/g, ' ').trim();

  // 5. Title Case each word, preserving intra-word apostrophes.
  const title = name
    .split(' ')
    .filter(Boolean)
    .map(toTitleCase)
    .join(' ');

  if (title.length === 0 || /^\d+$/.test(title)) return 'Chapter';
  return title;
}
