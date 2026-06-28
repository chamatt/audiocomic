import { State } from "@rivetkit/effect";
import { Effect, Schema } from "effect";
import { FileMetadata } from "../../lib/schemas.ts";
import { Storage, StorageLive } from "../../lib/services.ts";
import { FileRegistry } from "./api.ts";

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
		default:
			return "application/octet-stream";
	}
};

// --- Live implementation --------------------------------------------------

/**
 * Live `FileRegistry` layer. Wakes into a set of action handlers that
 * read/write the persisted state record and delegate byte storage to
 * the `Storage` service.
 *
 * `StorageLive` is provided on the wake Effect so the service is
 * available to every action handler regardless of how the layer is
 * composed by the host.
 */
export const FileRegistryLive = FileRegistry.toLayer(
	(wakeOptions) =>
		Effect.gen(function* () {
			const storage = yield* Storage;
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
					const storedPath = yield* storage
						.store(id, payload.originalName, data)
						.pipe(Effect.orDie);
					const sizeBytes = yield* storage
						.size(storedPath)
						.pipe(Effect.orDie);
					const metadata: FileMetadata = {
						id,
						originalName: payload.originalName,
						storedPath,
						mimeType: mimeFromName(payload.originalName),
						sizeBytes,
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
					const storedPath = yield* storage
						.storeFromPath(id, payload.sourcePath)
						.pipe(Effect.orDie);
					const sizeBytes = yield* storage
						.size(storedPath)
						.pipe(Effect.orDie);
					const metadata: FileMetadata = {
						id,
						originalName: payload.originalName,
						storedPath,
						mimeType: mimeFromName(payload.originalName),
						sizeBytes,
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
					yield* storage.delete(existing.storedPath).pipe(Effect.orDie);
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
		}).pipe(Effect.provide(StorageLive)),
	{
		state: {
			schema: FileRegistryState,
			initialValue: () => initialState,
		},
	},
);
