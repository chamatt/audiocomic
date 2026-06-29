// ============================================================================
// Shared local types for @audiocomic/media
// ============================================================================

/** Result of probing an audio file with ffprobe. */
export interface AudioProbe {
  /** Duration in seconds. */
  duration: number;
  /** Container format name (e.g. "mp3", "m4a"). */
  format: string;
  /** Overall bitrate in bits per second. */
  bitrate: number;
  /** Audio sample rate in Hz. */
  sampleRate: number;
  /** Number of audio channels. */
  channels: number;
  /** Audio codec name (e.g. "mp3", "aac"). */
  codec: string;
}

/** A chapter embedded in an audio file (e.g. m4b audiobook chapters). */
export interface EmbeddedChapter {
  id: number;
  start: number;
  end: number;
  duration: number;
  title: string;
}

/** Result of an export operation. */
export interface ExportResult {
  /** Absolute path to the produced artifact. */
  path: string;
  /** Duration in seconds (video/audio exports; 0 for static). */
  durationSec: number;
  /** Size of the produced artifact in bytes. */
  sizeBytes: number;
}

/** A parsed chapter from a textbook. */
export interface ParsedChapter {
  title: string;
  text: string;
  paragraphs: string[];
  /** Inclusive word index where this chapter starts (global across the book). */
  wordStart: number;
  /** Exclusive word index where this chapter ends. */
  wordEnd: number;
}

/** A parsed book split into chapters with global word indices. */
export interface ParsedBook {
  chapters: ParsedChapter[];
  /** Total word count across all chapters. */
  totalWords: number;
}

/** A chunk of text suitable for feeding to the planner. */
export interface TextChunk {
  index: number;
  text: string;
  /** Inclusive global word index where this chunk starts. */
  wordStart: number;
  /** Exclusive global word index where this chunk ends. */
  wordEnd: number;
}
