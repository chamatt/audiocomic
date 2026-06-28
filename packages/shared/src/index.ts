import { z } from 'zod';
import type { ProviderSettings } from '@audiocomic/domain';

// ============================================================================
// Logger — structured, scoped, visible everywhere
// ============================================================================
//
// Usage:
//   import { logger } from '@audiocomic/shared';
//   const log = logger.scoped('transcription');
//   log.info('starting', { audioPath, model });
//   log.debug('multipart payload', { size, ext });
//   log.error('groq failed', { status, body });
//
// Levels controlled by LOG_LEVEL env var (debug/info/warn/error).
// Default: info. In tests: warn.
//
// Output goes to stderr (so it never interferes with stdout piping).
// Format: [ISO] LEVEL [scope] message {json}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): LogLevel {
  const env = (typeof process !== 'undefined' && process.env.LOG_LEVEL) || 'info';
  if (env in LEVEL_ORDER) return env as LogLevel;
  return 'info';
}

function formatValue(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatContext(ctx: Record<string, unknown> | undefined): string {
  if (!ctx || Object.keys(ctx).length === 0) return '';
  const pairs = Object.entries(ctx).map(([k, v]) => `${k}=${formatValue(v)}`);
  return ` {${pairs.join(', ')}}`;
}

class ScopedLogger {
  readonly scope: string;
  readonly level: LogLevel;

  constructor(scope: string, level?: LogLevel) {
    this.scope = scope;
    this.level = level ?? currentLevel();
  }

  scoped(subscope: string): ScopedLogger {
    return new ScopedLogger(`${this.scope}:${subscope}`, this.level);
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    const ts = new Date().toISOString();
    const line = `${ts} ${level.toUpperCase().padEnd(5)} [${this.scope}] ${msg}${formatContext(ctx)}`;
    // stderr so it never breaks stdout piping / API responses
    process.stderr.write(line + '\n');
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('debug', msg, ctx);
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('info', msg, ctx);
  }

  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('warn', msg, ctx);
  }

  error(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('error', msg, ctx);
  }

  /** Timer helper: returns a function that logs the elapsed duration. */
  timer(label: string, ctx?: Record<string, unknown>): () => void {
    const start = Date.now();
    return () => {
      const ms = Date.now() - start;
      this.info(`${label} done`, { ...ctx, ms });
    };
  }
}

/** Root logger — use directly or create scoped children. */
export const logger = new ScopedLogger('audiocomic');

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

  // Pollinations (open-source image generation)
  POLLINATIONS_API_KEY: z.string().optional(),

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

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Feature flags
  FEATURE_DIARIZATION: z.string().optional().transform((v) => v !== 'false'),
  FEATURE_TTS_FALLBACK: z.string().optional().transform((v) => v === 'true'),
  FEATURE_PANEL_QA: z.string().optional().transform((v) => v !== 'false'),
  FEATURE_MOTION_COMIC: z.string().optional().transform((v) => v !== 'false'),

  // Defaults
  DEFAULT_RENDERER: z.enum(['comfyui', 'aisdk', 'pollinations', 'placeholder']).default('placeholder'),
  DEFAULT_LLM_MODEL: z.string().default('gpt-4o'),
  DEFAULT_IMAGE_MODEL: z.string().default('gpt-image-1-mini'),
  DEFAULT_TTS_VOICE: z.string().default('alloy'),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function loadEnv(raw: Record<string, string | undefined> = process.env): Env {
  _env = EnvSchema.parse(raw);
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
    diarization: env.FEATURE_DIARIZATION,
    ttsFallback: env.FEATURE_TTS_FALLBACK,
    panelQA: env.FEATURE_PANEL_QA,
    motionComic: env.FEATURE_MOTION_COMIC,
  };
}

// ============================================================================
// Default provider settings — resolved from env
// ============================================================================

export function defaultProviderSettings(env: Env = getEnv()): ProviderSettings {
  return {
    llm: {
      provider: 'openrouter',
      model: env.DEFAULT_LLM_MODEL,
      apiKey: env.OPENROUTER_API_KEY ?? '',
    },
    transcription: {
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      apiKey: env.GROQ_API_KEY ?? '',
    },
    image: {
      provider: env.DEFAULT_RENDERER,
      model: env.DEFAULT_IMAGE_MODEL,
      apiKey: env.POLLINATIONS_API_KEY ?? env.COMFYUI_API_KEY ?? '',
    },
    tts: {
      provider: 'elevenlabs',
      model: 'eleven_multilingual_v2',
      apiKey: env.ELEVENLABS_API_KEY ?? '',
    },
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
