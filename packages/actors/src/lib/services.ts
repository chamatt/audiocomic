import { Context, Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ============================================================================
// Storage service — centralized file storage shared across projects
// ============================================================================

export const STORAGE_DIR = process.env.STORAGE_DIR ?? path.join(process.cwd(), "uploads");

export interface StorageShape {
	store: (id: string, originalName: string, data: Buffer) => Effect.Effect<string, Error>;
	storeFromPath: (id: string, sourcePath: string) => Effect.Effect<string, Error>;
	getPath: (id: string, ext: string) => Effect.Effect<string>;
	delete: (storedPath: string) => Effect.Effect<void>;
	exists: (storedPath: string) => Effect.Effect<boolean>;
	size: (storedPath: string) => Effect.Effect<number, Error>;
	read: (storedPath: string) => Effect.Effect<Buffer, Error>;
}

export const Storage = Context.Service<StorageShape>("Storage");

export const StorageLive = Layer.succeed(Storage, {
	store: (id: string, originalName: string, data: Buffer) =>
		Effect.gen(function* () {
			yield* Effect.tryPromise(() => fs.mkdir(STORAGE_DIR, { recursive: true }));
			const ext = path.extname(originalName);
			const storedPath = path.join(STORAGE_DIR, `${id}${ext}`);
			yield* Effect.tryPromise(() => fs.writeFile(storedPath, data));
			return storedPath;
		}),
	storeFromPath: (id: string, sourcePath: string) =>
		Effect.gen(function* () {
			yield* Effect.tryPromise(() => fs.mkdir(STORAGE_DIR, { recursive: true }));
			const ext = path.extname(sourcePath);
			const storedPath = path.join(STORAGE_DIR, `${id}${ext}`);
			yield* Effect.tryPromise(() => fs.copyFile(sourcePath, storedPath));
			return storedPath;
		}),
	getPath: (id: string, ext: string) =>
		Effect.sync(() => path.join(STORAGE_DIR, `${id}.${ext}`)),
	delete: (storedPath: string) =>
		Effect.tryPromise(() => fs.unlink(storedPath) as Promise<void>).pipe(Effect.ignore),
	exists: (storedPath: string) =>
		Effect.tryPromise(() => fs.access(storedPath).then(() => true)).pipe(
			Effect.catchCause(() => Effect.succeed(false)),
		),
	size: (storedPath: string) =>
		Effect.tryPromise(() => fs.stat(storedPath).then((s) => s.size)),
	read: (storedPath: string) =>
		Effect.tryPromise(() => fs.readFile(storedPath)),
});

// ============================================================================
// FFmpeg service — wraps ffmpeg/ffprobe for audio probing and chapter splitting
// ============================================================================

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

export interface Chapter {
	id: number;
	start: number;
	end: number;
	duration: number;
	title: string;
}

export interface FFmpegShape {
	getChapters: (filePath: string) => Effect.Effect<Chapter[], Error>;
	getDuration: (filePath: string) => Effect.Effect<number, Error>;
	splitChapter: (inputPath: string, outputPath: string, start: number, duration: number) => Effect.Effect<void, Error>;
	exec: (args: string[]) => Effect.Effect<{ stdout: string; stderr: string }, Error>;
}

export const FFmpeg = Context.Service<FFmpegShape>("FFmpeg");

export const FFmpegLive = Layer.succeed(FFmpeg, {
	getChapters: (filePath: string) =>
		Effect.gen(function* () {
			const { stdout } = yield* Effect.tryPromise(() =>
				execFileAsync(FFPROBE, ["-v", "quiet", "-print_format", "json", "-show_chapters", filePath], { maxBuffer: 10 * 1024 * 1024 }),
			);
			const data = JSON.parse(stdout) as { chapters?: Array<{ start: number; end: number; tags?: { title?: string } }> };
			if (!data.chapters) return [];
			return data.chapters.map((ch, i): Chapter => {
				const start = ch.start / 1_000_000;
				const end = ch.end / 1_000_000;
				return { id: i + 1, start, end, duration: end - start, title: ch.tags?.title ?? `Chapter ${i + 1}` };
			});
		}),
	getDuration: (filePath: string) =>
		Effect.gen(function* () {
			const { stdout } = yield* Effect.tryPromise(() =>
				execFileAsync(FFPROBE, ["-v", "quiet", "-print_format", "json", "-show_format", filePath], { maxBuffer: 10 * 1024 * 1024 }),
			);
			const data = JSON.parse(stdout) as { format?: { duration?: string } };
			return parseFloat(data.format?.duration ?? "0");
		}),
	splitChapter: (inputPath: string, outputPath: string, start: number, duration: number) =>
		Effect.gen(function* () {
			yield* Effect.tryPromise(() =>
				execFileAsync(FFMPEG, ["-ss", start.toFixed(3), "-i", inputPath, "-t", duration.toFixed(3), "-c", "copy", "-f", "mp4", "-y", outputPath], { maxBuffer: 10 * 1024 * 1024 }),
			);
		}),
	exec: (args: string[]) =>
		Effect.tryPromise(() => execFileAsync(FFMPEG, args, { maxBuffer: 100 * 1024 * 1024 })).pipe(
			Effect.map(({ stdout, stderr }) => ({ stdout, stderr })),
		),
});

// ============================================================================
// Pipeline adapter service — wraps existing packages/ai, packages/renderers, packages/media
// This is the bridge between Rivet actors and the existing deterministic services
// ============================================================================

export interface PipelineAdapterShape {
	// AI adapters
	transcribe: (audioPath: string) => Effect.Effect<{ chunks: unknown[]; durationSec: number }, Error>;
	planStory: (input: unknown) => Effect.Effect<unknown, Error>;
	composePrompt: (input: unknown) => Effect.Effect<string, Error>;
	// Renderer
	renderPanel: (req: unknown) => Effect.Effect<unknown, Error>;
	// Media
	probeAudio: (path: string) => Effect.Effect<{ durationSec: number }, Error>;
	parseTextBook: (content: string) => Effect.Effect<unknown, Error>;
	composePage: (panelImages: Buffer[], pageSpec: unknown, panelSpecs: unknown[], size: unknown) => Effect.Effect<Buffer, Error>;
	exportMotionComic: (timeline: unknown, pageImages: Map<string, string>, audioPath: string | undefined, outputPath: string) => Effect.Effect<{ sizeBytes: number; durationSec: number }, Error>;
	exportPageBundle: (pageImages: string[], outputPath: string) => Effect.Effect<{ sizeBytes: number }, Error>;
}

export const PipelineAdapter = Context.Service<PipelineAdapterShape>("PipelineAdapter");

// Live implementation that dynamically imports existing packages
export const PipelineAdapterLive = Layer.effectDiscard(
	Effect.gen(function* () {
		// The actual adapters are created at runtime via deps.ts
		// For now, this is a placeholder that will be wired in the server entry point
		yield* Effect.log("PipelineAdapter layer initialized (will be wired to existing packages)");
	}),
);
