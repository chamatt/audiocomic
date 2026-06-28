import type {
  TranscriptChunk,
  WordTiming,
  SpeakerTurn,
  StorySection,
  CharacterProfile,
  WorldBible,
  PanelSpec,
  CameraFraming,
  EmotionalTone,
} from '@audiocomic/domain';
import type { Env } from '@audiocomic/shared';

// ============================================================================
// Provider identifiers
// ============================================================================

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'groq' | 'openrouter';
export type TranscriptionProvider = 'openai' | 'deepgram' | 'groq';
export type TTSProvider = 'openai' | 'elevenlabs' | 'coqui';
export type ImageProvider = 'openai' | 'fal' | 'stability' | 'comfyui' | 'placeholder';

// ============================================================================
// Transcription
// ============================================================================

export interface TranscriptionOptions {
  projectId: string;
  /** BCP-47 language hint, e.g. "en" */
  language?: string;
  /** Optional prompt to bias Whisper decoding (context / spelling hints) */
  prompt?: string;
  /** Sampling temperature 0..1 */
  temperature?: number;
  /** Override the model id (default: whisper-1) */
  model?: string;
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface TranscriptResult {
  chunks: TranscriptChunk[];
  /** Flat word-level timings across the whole audio */
  words: WordTiming[];
  /** Optional speaker turns (populated by a diarization pass) */
  speakers?: SpeakerTurn[];
  /** Detected language (ISO-639-1) */
  language?: string;
  /** Total audio duration in seconds */
  durationSec?: number;
}

export interface TranscriptionAdapter {
  transcribe(audioPath: string, opts: TranscriptionOptions): Promise<TranscriptResult>;
}

// ============================================================================
// Diarization
// ============================================================================

export interface DiarizationOptions {
  projectId: string;
  /** Minimum number of speakers; providers may infer if omitted */
  minSpeakers?: number;
  /** Maximum number of speakers */
  maxSpeakers?: number;
  signal?: AbortSignal;
}

export interface DiarizationAdapter {
  diarize(
    audioPath: string,
    chunks: TranscriptChunk[],
    opts: DiarizationOptions,
  ): Promise<SpeakerTurn[]>;
}

// ============================================================================
// Story planner
// ============================================================================

export interface StoryPlanInput {
  projectId: string;
  /** Full source text (transcript or uploaded text) */
  text: string;
  /** Optional genre / art-style hints to bias the plan */
  genre?: string[];
  artStyle?: string;
  language?: string;
  /** Override the LLM model id */
  model?: string;
  /** Target approximate panels per beat (default 1) */
  panelsPerBeat?: number;
  signal?: AbortSignal;
}

export interface PanelHint {
  /** Id of the beat StorySection this hint applies to */
  beatSectionId: string;
  beatIndex: number;
  description: string;
  cameraFraming?: CameraFraming;
  characters: {
    name: string;
    pose?: string;
    expression?: string;
    position?: 'left' | 'center' | 'right' | 'background';
  }[];
  dialogueLines: {
    speaker: string;
    text: string;
    type: 'speech' | 'thought' | 'narration' | 'sfx';
  }[];
}

export interface StoryPlanOutput {
  sections: StorySection[];
  characters: CharacterProfile[];
  worldBible: WorldBible;
  /** Per-beat page/panel allocation hints from the third planner pass */
  panelHints?: PanelHint[];
}

export interface StoryPlannerAdapter {
  planStory(input: StoryPlanInput): Promise<StoryPlanOutput>;
}

// ============================================================================
// TTS
// ============================================================================

export interface TTSOptions {
  voice?: string;
  model?: string;
  /** Output format e.g. "mp3", "wav", "opus" */
  format?: string;
  /** Speed multiplier 0.25..4 */
  speed?: number;
  /** Style/instruction prompt (gpt-4o-mini-tts) */
  instructions?: string;
  signal?: AbortSignal;
}

export interface TTSResult {
  /** Raw audio bytes */
  audio: Uint8Array;
  /** MIME type, e.g. "audio/mpeg" */
  mimeType: string;
  /** Format name, e.g. "mp3" */
  format: string;
  /** Estimated duration in seconds, if known */
  durationSec?: number;
}

export interface TTSAdapter {
  synthesize(text: string, opts?: TTSOptions): Promise<TTSResult>;
}

// ============================================================================
// Image generation
// ============================================================================

export interface ImageOptions {
  width?: number;
  height?: number;
  seed?: number;
  negativePrompt?: string;
  /** Number of images (default 1) */
  n?: number;
  /** Override the model id */
  model?: string;
  /** Aspect ratio "W:H" — alternative to width/height */
  aspectRatio?: string;
  /** Extra provider-specific options */
  providerOptions?: Record<string, Record<string, unknown>>;
  signal?: AbortSignal;
}

export interface ImageResult {
  /** Raw image bytes */
  image: Uint8Array;
  /** MIME type, e.g. "image/png" */
  mimeType: string;
  width?: number;
  height?: number;
  seed?: number;
  model?: string;
}

export interface ImageAdapter {
  generateImage(prompt: string, opts?: ImageOptions): Promise<ImageResult>;
}

// ============================================================================
// Re-exports of domain types that adapter implementers commonly need
// ============================================================================

export type {
  TranscriptChunk,
  WordTiming,
  SpeakerTurn,
  StorySection,
  CharacterProfile,
  WorldBible,
  PanelSpec,
  CameraFraming,
  EmotionalTone,
  Env,
};
