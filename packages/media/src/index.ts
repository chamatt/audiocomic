// ============================================================================
// @audiocomic/media — audio/text ingestion, motion-comic & static export,
// lettering overlay, and page composition.
// ============================================================================

export { probeAudio, extractAudioDuration } from './audio.js';
export { parseTextBook, splitIntoChunks } from './text.js';
export {
  exportMotionComic,
  type PageImageSource,
  type MotionExportOptions,
} from './motion.js';
export { exportPageBundle, exportPdf, pageBasename } from './static.js';
export { renderLetteringOverlay } from './lettering.js';
export { composePage, type OutputSize, type ComposeOptions } from './composite.js';

export type {
  AudioProbe,
  ExportResult,
  ParsedBook,
  ParsedChapter,
  TextChunk,
} from './types.js';
