// ============================================================================
// @audiocomic/media — audio/text ingestion, motion-comic & static export,
// lettering overlay, and page composition.
// ============================================================================

export { probeAudio, extractAudioDuration, probeChapters, splitAudioChapter } from './audio';
export { parseTextBook, splitIntoChunks } from './text';
export {
  exportMotionComic,
  type PageImageSource,
  type MotionExportOptions,
} from './motion';
export { exportPageBundle, exportPdf, pageBasename } from './static';
export { renderLetteringOverlay } from './lettering';
export { composePage, type OutputSize, type ComposeOptions } from './composite';

export type {
  AudioProbe,
  EmbeddedChapter,
  ExportResult,
  ParsedBook,
  ParsedChapter,
  TextChunk,
} from './types';
