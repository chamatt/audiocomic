import { z } from 'zod';
import type { ProviderSettings } from '@audiocomic/domain';

// ============================================================================
// Environment configuration — single source of truth, validated at boot
// ============================================================================

export const EnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().default('postgres://localhost:5432/audiocomic'),

  // Object storage (S3-compatible)
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().default('audiocomic'),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  STORAGE_USE_LOCAL: z.string().optional().transform((v) => v === 'true'),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().optional(),

  // Google
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

  // Groq
  GROQ_API_KEY: z.string().optional(),

  // OpenRouter (OpenAI-compatible gateway)
  OPENROUTER_API_KEY: z.string().optional(),

  // ComfyUI
  COMFYUI_URL: z.string().url().optional(),
  COMFYUI_API_KEY: z.string().optional(),

  // Fal
  FAL_KEY: z.string().optional(),

  // ElevenLabs
  ELEVENLABS_API_KEY: z.string().optional(),

  // FFmpeg
  FFMPEG_BIN: z.string().default('ffmpeg'),
  FFPROBE_BIN: z.string().default('ffprobe'),

  // App
  WEB_PORT: z.string().default('3000'),
  WORKER_CONCURRENCY: z.string().default('4'),
  UPLOAD_DIR: z.string().default('./uploads'),
  EXPORT_DIR: z.string().default('./exports'),

  // Feature flags
  FEATURE_DIARIZATION: z.string().optional().transform((v) => v !== 'false'),
  FEATURE_TTS_FALLBACK: z.string().optional().transform((v) => v === 'true'),
  FEATURE_PANEL_QA: z.string().optional().transform((v) => v !== 'false'),
  FEATURE_MOTION_COMIC: z.string().optional().transform((v) => v !== 'false'),

  // Defaults
  DEFAULT_RENDERER: z.enum(['comfyui', 'aisdk', 'placeholder']).default('placeholder'),
  DEFAULT_LLM_MODEL: z.string().default('gpt-4o'),
  DEFAULT_IMAGE_MODEL: z.string().default('gpt-image-1-mini'),
  DEFAULT_TTS_VOICE: z.string().default('alloy'),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function loadEnv(raw: Record<string, string | undefined> = process.env): Env {
  if (_env) return _env;
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${errors}`);
  }
  _env = parsed.data;
  return _env;
}

export function getEnv(): Env {
  if (!_env) return loadEnv();
  return _env;
}

export function resetEnv(): void {
  _env = null;
}

// ============================================================================
// Feature flags
// ============================================================================

export interface FeatureFlags {
  diarization: boolean;
  ttsFallback: boolean;
  panelQA: boolean;
  motionComic: boolean;
}

export function getFeatureFlags(env: Env = getEnv()): FeatureFlags {
  return {
    diarization: env.FEATURE_DIARIZATION ?? true,
    ttsFallback: env.FEATURE_TTS_FALLBACK ?? false,
    panelQA: env.FEATURE_PANEL_QA ?? true,
    motionComic: env.FEATURE_MOTION_COMIC ?? true,
  };
}

// ============================================================================
// Default provider settings — resolved from env
// ============================================================================

export function defaultProviderSettings(env: Env = getEnv()): ProviderSettings {
  return {
    transcriptionProvider: env.OPENAI_API_KEY ? 'openai' : undefined,
    llmProvider: env.OPENAI_API_KEY
      ? 'openai'
      : env.ANTHROPIC_API_KEY
        ? 'anthropic'
        : env.GOOGLE_GENERATIVE_AI_API_KEY
          ? 'google'
          : undefined,
    llmModel: env.DEFAULT_LLM_MODEL,
    imageProvider: env.DEFAULT_RENDERER === 'comfyui' ? 'comfyui' : env.DEFAULT_RENDERER === 'aisdk' ? 'openai' : 'placeholder',
    imageModel: env.DEFAULT_IMAGE_MODEL,
    ttsProvider: env.OPENAI_API_KEY ? 'openai' : undefined,
    ttsVoice: env.DEFAULT_TTS_VOICE,
    rendererBackend: env.DEFAULT_RENDERER,
  };
}

// ============================================================================
// Storage key helpers
// ============================================================================

export function storageKey(projectId: string, kind: string, name: string): string {
  return `projects/${projectId}/${kind}/${name}`;
}

export function panelImageKey(projectId: string, panelId: string, version: number): string {
  return storageKey(projectId, 'panels', `${panelId}-v${version}.png`);
}

export function pageImageKey(projectId: string, pageId: string, version: number): string {
  return storageKey(projectId, 'pages', `${pageId}-v${version}.png`);
}

export function letteringKey(projectId: string, pageId: string, version: number): string {
  return storageKey(projectId, 'lettering', `${pageId}-v${version}.svg`);
}

export function exportKey(projectId: string, bundleId: string, ext: string): string {
  return storageKey(projectId, 'exports', `${bundleId}.${ext}`);
}

// ============================================================================
// ID generation
// ============================================================================

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
