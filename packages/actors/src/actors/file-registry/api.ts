import { Action, Actor } from "@rivetkit/effect";
import { Schema } from "effect";
import { FileMetadata } from "../../lib/schemas.ts";

/**
 * FileRegistry actor — centralized storage registry for uploaded and
 * pipeline-generated files. Tracks metadata (id, stored path, mime,
 * size, tags, project association) in actor state and delegates byte
 * storage to the `Storage` service.
 */

// --- Actions --------------------------------------------------------------

/**
 * Upload a file from base64-encoded bytes. The actor persists the
 * decoded buffer via the `Storage` service and records the resulting
 * `FileMetadata` in its state.
 */
export const Upload = Action.make("Upload", {
	payload: {
		originalName: Schema.String,
		base64Data: Schema.String,
		tags: Schema.Array(Schema.String),
		projectId: Schema.optional(Schema.String),
	},
	success: FileMetadata,
});

/**
 * Register an existing file on disk by copying it into centralized
 * storage. Used when a pipeline stage produces a file on a known
 * source path and wants it tracked by the registry.
 */
export const RegisterPath = Action.make("RegisterPath", {
	payload: {
		originalName: Schema.String,
		sourcePath: Schema.String,
		tags: Schema.Array(Schema.String),
		projectId: Schema.optional(Schema.String),
	},
	success: FileMetadata,
});

/**
 * Look up a single file by id. Resolves to `undefined` when no file
 * with the given id is registered.
 */
export const GetFile = Action.make("GetFile", {
	payload: {
		id: Schema.String,
	},
	success: Schema.optional(FileMetadata),
});

/**
 * List registered files, optionally filtered by tag and/or project id.
 */
export const ListFiles = Action.make("ListFiles", {
	payload: {
		tag: Schema.optional(Schema.String),
		projectId: Schema.optional(Schema.String),
	},
	success: Schema.Array(FileMetadata),
});

/**
 * Delete a file by id. Removes its metadata from state and deletes
 * the underlying stored bytes. Resolves to `true` when a file was
 * removed, `false` when the id was not registered.
 */
export const DeleteFile = Action.make("DeleteFile", {
	payload: {
		id: Schema.String,
	},
	success: Schema.Boolean,
});

// --- Actor contract -------------------------------------------------------

export const FileRegistry = Actor.make("FileRegistry", {
	actions: [Upload, RegisterPath, GetFile, ListFiles, DeleteFile],
});
