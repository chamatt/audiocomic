import type { ParsedBook, ParsedChapter, TextChunk } from './types.js';

// ============================================================================
// Textbook parsing
// ============================================================================

/** Matches common chapter headers: "Chapter 1", "Chapter XII", "Chapter Three". */
const CHAPTER_RE = /^[ \t]*chapter\s+([0-9]+|[ivxlcdm]+|[a-z][a-z\s'"-]*?)[ \t]*$/im;

function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Split text into paragraphs on blank lines, dropping empties. */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\r/g, '').trim())
    .filter((p) => p.length > 0);
}

/**
 * Parse raw textbook content into chapters with global word-index ranges.
 *
 * Detection order:
 *   1. "Chapter X" headers (numeric, roman numeral, or word form).
 *   2. Fallback: blank-line-separated sections become chapters.
 *
 * Each chapter carries global wordStart/wordEnd indices so downstream stages
 * (planner, transcript alignment) can reference ranges across the whole book.
 */
export function parseTextBook(content: string): ParsedBook {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const chapters: ParsedChapter[] = [];

  // Try chapter-header splitting first.
  const headerIndices: { index: number; title: string }[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(CHAPTER_RE.source, 'gim');
  while ((match = re.exec(normalized)) !== null) {
    const rawTitle = match[1] ?? '';
    const title = `Chapter ${rawTitle.trim().toUpperCase()}`;
    headerIndices.push({ index: match.index, title });
  }

  if (headerIndices.length > 0) {
    for (let i = 0; i < headerIndices.length; i++) {
      const start = headerIndices[i]!.index;
      // Skip past the header line itself.
      const lineEnd = normalized.indexOf('\n', start);
      const bodyStart = lineEnd === -1 ? normalized.length : lineEnd + 1;
      const bodyEnd =
        i + 1 < headerIndices.length
          ? headerIndices[i + 1]!.index
          : normalized.length;
      const text = normalized.slice(bodyStart, bodyEnd).trim();
      if (text.length === 0) continue;
      chapters.push({
        title: headerIndices[i]!.title,
        text,
        paragraphs: splitParagraphs(text),
        wordStart: 0,
        wordEnd: 0,
      });
    }
  }

  // Fallback: no chapter headers — treat blank-line-separated sections as chapters.
  if (chapters.length === 0) {
    const sections = normalized.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (sections.length === 0) {
      const trimmed = normalized.trim();
      if (trimmed.length > 0) sections.push(trimmed);
    }
    for (let i = 0; i < sections.length; i++) {
      const text = sections[i] ?? '';
      chapters.push({
        title: `Section ${i + 1}`,
        text,
        paragraphs: splitParagraphs(text),
        wordStart: 0,
        wordEnd: 0,
      });
    }
  }

  // Assign global word indices.
  let cursor = 0;
  for (const ch of chapters) {
    const words = countWords(ch.text);
    ch.wordStart = cursor;
    ch.wordEnd = cursor + words;
    cursor += words;
  }

  return { chapters, totalWords: cursor };
}

// ============================================================================
// Chunking for the planner
// ============================================================================

/**
 * Split text into chunks of at most `maxWords` words, breaking on sentence
 * boundaries when possible to avoid mid-sentence splits. Each chunk carries
 * global word-index ranges relative to the supplied text.
 */
export function splitIntoChunks(text: string, maxWords: number): TextChunk[] {
  if (maxWords <= 0) throw new Error('maxWords must be positive');
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return [];

  // Split into sentences while keeping the trailing delimiter.
  const sentences = normalized.match(/[^.!?]+[.!?]*/g) ?? [normalized];
  const chunks: TextChunk[] = [];
  let current: string[] = [];
  let currentWords = 0;
  let wordCursor = 0;
  let chunkStart = 0;
  let index = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const chunkText = current.join(' ').replace(/\s+/g, ' ').trim();
    const words = chunkText.match(/\S+/g);
    const wordCount = words ? words.length : 0;
    chunks.push({
      index,
      text: chunkText,
      wordStart: chunkStart,
      wordEnd: chunkStart + wordCount,
    });
    index += 1;
    chunkStart += wordCount;
    current = [];
    currentWords = 0;
  };

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (s.length === 0) continue;
    const sWords = s.match(/\S+/g);
    const sCount = sWords ? sWords.length : 0;

    // A single sentence longer than maxWords: hard-split by words.
    if (sCount > maxWords) {
      flush();
      const words = s.split(/\s+/);
      for (let i = 0; i < words.length; i += maxWords) {
        const slice = words.slice(i, i + maxWords).join(' ');
        const w = slice.match(/\S+/g);
        const wc = w ? w.length : 0;
        chunks.push({
          index,
          text: slice,
          wordStart: chunkStart,
          wordEnd: chunkStart + wc,
        });
        index += 1;
        chunkStart += wc;
      }
      wordCursor = chunkStart;
      continue;
    }

    if (currentWords + sCount > maxWords) {
      flush();
    }
    current.push(s);
    currentWords += sCount;
    wordCursor += sCount;
  }
  flush();

  return chunks;
}
