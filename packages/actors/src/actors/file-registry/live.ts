import { State } from "@rivetkit/effect";
import { Effect, Schema } from "effect";
import { FileMetadata } from "../../lib/schemas.ts";
import { FileRegistry } from "./api.ts";
import { createMediaManagerFromEnv, type MediaManager } from "@audiocomic/storage";
import { getEnv } from "@audiocomic/shared";
import { promises as fs } from "node:fs";
import { extname } from "node:path";

// --- State schema ---------------------------------------------------------

/**
 * FileRegistry state is a record of file id -> metadata. Persisted by
 * Rivet across wakes so the registry survives actor eviction.
 */
const FileRegistryState = Schema.Struct({
	files: Schema.Record(Schema.String, FileMetadata),
});
type FileRegistryState = Schema.Schema.Type<typeof FileRegistryState>;

const initialState: FileRegistryState = { files: {} };

// --- Helpers --------------------------------------------------------------

/** Cryptographically-random id for new files. */
const newFileId = (): string =>
	`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Best-effort MIME type from an extension. */
const mimeFromName = (name: string): string => {
	const ext = name.toLowerCase().split(".").pop() ?? "";
	switch (ext) {
		case "mp3":
			return "audio/mpeg";
		case "wav":
			return "audio/wav";
		case "m4a":
		case "aac":
			return "audio/aac";
		case "m4b":
			return "audio/mp4";
		case "flac":
			return "audio/flac";
		case "ogg":
			return "audio/ogg";
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "webp":
			return "image/webp";
		case "gif":
			return "image/gif";
		case "mp4":
			return "video/mp4";
		case "webm":
			return "video/webm";
		case "json":
			return "application/json";
		case "txt":
			return "text/plain";
		case "svg":
			return "image/svg+xml";
		default:
			return "application/octet-stream";
	}
};

/** Build a storage key from file id and original extension. */
function storageKeyFor(id: string, originalName: string): string {
	const ext = extname(originalName);
	return `registry/${id}${ext}`;
}

// --- Live implementation --------------------------------------------------

/**
 * Live `FileRegistry` layer. Wakes into a set of action handlers that
 * read/write the persisted state record and delegate byte storage to
 * the `MediaManager` service (S3-compatible or local filesystem).
 */
export const FileRegistryLive = FileRegistry.toLayer(
	(wakeOptions) =>
		Effect.gen(function* () {
			const env = getEnv();
			const mediaManager: MediaManager = createMediaManagerFromEnv(env);
			const { rawRivetkitContext, state } = wakeOptions;

			const upload = ({ payload }: { payload: {
				originalName: string;
				base64Data: string;
				tags: ReadonlyArray<string>;
				projectId?: string;
			} }) =>
				Effect.gen(function* () {
					const id = newFileId();
					const data = Buffer.from(payload.base64Data, "base64");
					const storageKey = storageKeyFor(id, payload.originalName);
					const mimeType = mimeFromName(payload.originalName);

					const result = yield* Effect.tryPromise(() =>
						mediaManager.upload(storageKey, data, mimeType),
					).pipe(Effect.orDie);

					const metadata: FileMetadata = {
						id,
						originalName: payload.originalName,
						storageKey: result.key,
						mimeType,
						sizeBytes: result.size,
						uploadedAt: Date.now(),
						tags: [...payload.tags],
						projectId: payload.projectId,
					};
					yield* State.updateAndGet(state, (s) => ({
						files: { ...s.files, [id]: metadata },
					})).pipe(Effect.orDie);
					rawRivetkitContext.broadcast("fileUploaded", metadata);
					return metadata;
				});

			const registerPath = ({ payload }: { payload: {
				originalName: string;
				sourcePath: string;
				tags: ReadonlyArray<string>;
				projectId?: string;
			} }) =>
				Effect.gen(function* () {
					const id = newFileId();
					const storageKey = storageKeyFor(id, payload.originalName);
					const mimeType = mimeFromName(payload.originalName);

					// Read the source file and upload it to MediaManager
					const data = yield* Effect.tryPromise(() =>
						fs.readFile(payload.sourcePath),
					).pipe(Effect.orDie);

					const result = yield* Effect.tryPromise(() =>
						mediaManager.upload(storageKey, data, mimeType),
					).pipe(Effect.orDie);

					const metadata: FileMetadata = {
						id,
						originalName: payload.originalName,
						storageKey: result.key,
						mimeType,
						sizeBytes: result.size,
						uploadedAt: Date.now(),
						tags: [...payload.tags],
						projectId: payload.projectId,
					};
					yield* State.updateAndGet(state, (s) => ({
						files: { ...s.files, [id]: metadata },
					})).pipe(Effect.orDie);
					rawRivetkitContext.broadcast("fileUploaded", metadata);
					return metadata;
				});

			const getFile = ({ payload }: { payload: { id: string } }) =>
				Effect.gen(function* () {
					const s = yield* State.get(state).pipe(Effect.orDie);
					return s.files[payload.id] ?? undefined;
				});

			const listFiles = ({ payload }: { payload: {
				tag?: string;
				projectId?: string;
			} }) =>
				Effect.gen(function* () {
					const s = yield* State.get(state).pipe(Effect.orDie);
					return Object.values(s.files).filter((f) => {
						if (payload.tag !== undefined && !f.tags.includes(payload.tag)) {
							return false;
						}
						if (
							payload.projectId !== undefined &&
							f.projectId !== payload.projectId
						) {
							return false;
						}
						return true;
					});
				});

			const deleteFile = ({ payload }: { payload: { id: string } }) =>
				Effect.gen(function* () {
					const s = yield* State.get(state).pipe(Effect.orDie);
					const existing = s.files[payload.id];
					if (!existing) return false;
					yield* Effect.tryPromise(() =>
						mediaManager.delete(existing.storageKey),
					).pipe(Effect.orDie);
					yield* State.updateAndGet(state, (prev) => {
						const files = { ...prev.files };
						delete files[payload.id];
						return { files };
					}).pipe(Effect.orDie);
					return true;
				});

			return {
				Upload: upload,
				RegisterPath: registerPath,
				GetFile: getFile,
				ListFiles: listFiles,
				DeleteFile: deleteFile,
			};
		}),
	{
		state: {
			schema: FileRegistryState,
			initialValue: () => initialState,
		},
	},
);
