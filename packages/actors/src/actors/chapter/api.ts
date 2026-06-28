import { Schema } from "effect";
import { Action, Actor } from "@rivetkit/effect";

/**
 * Chapter actor state — the actor's durable projection of a Chapter domain
 * entity. Mirrors the fields a client needs to render a chapter card and
 * drive the per-chapter pipeline: identity, ordering, the linked source
 * asset, lifecycle status, transcription status, and the optional pipeline
 * instance attached to this chapter.
 *
 * `createdAt` / `updatedAt` are intentionally omitted — the actor state is a
 * working snapshot, not an audit log; persistence of the canonical row lives
 * in the `chapters` table via the repository.
 */
export const ChapterState = Schema.Struct({
	id: Schema.String,
	projectId: Schema.String,
	index: Schema.Number,
	title: Schema.String,
	description: Schema.optional(Schema.String),
	sourceAssetId: Schema.optional(Schema.String),
	status: Schema.String,
	durationSec: Schema.optional(Schema.Number),
	transcriptionStatus: Schema.String,
	pipelineId: Schema.optional(Schema.String),
});
export type ChapterState = Schema.Schema.Type<typeof ChapterState>;

/**
 * Chapter actor contract.
 *
 * One ChapterActor instance per chapter. It owns the chapter's mutable
 * metadata, the link to its source audio asset, and the transcription
 * lifecycle. Every mutating action returns the full updated {@link
 * ChapterState} so callers can reconcile against a single source of truth
 * without a follow-up read.
 *
 * `StartTranscription` kicks off transcription as a background daemon fiber
 * and returns immediately with the chapter in the `running` transcription
 * state; the fiber persists chunks, flips the state to `completed`, and
 * broadcasts `chapterTranscribed` when done (or `failed` on error).
 */
export const Chapter = Actor.make("Chapter", {
	actions: [
		// Read the current chapter state.
		Action.make("GetState", {
			success: ChapterState,
		}),

		// Update the human-readable chapter title.
		// Initialize identity fields (id, projectId, index). Must be called
		// once immediately after actor creation, before any other action.
		Action.make("Init", {
			payload: {
				id: Schema.String,
				projectId: Schema.String,
				index: Schema.Number,
			},
			success: ChapterState,
		}),

		Action.make("UpdateTitle", {
			payload: { title: Schema.String },
			success: ChapterState,
		}),

		// Update the human-readable chapter description.
		Action.make("UpdateDescription", {
			payload: { description: Schema.String },
			success: ChapterState,
		}),

		// Link a SourceAsset to this chapter by id.
		Action.make("LinkAsset", {
			payload: { sourceAssetId: Schema.String },
			success: ChapterState,
		}),

		// Set the chapter lifecycle status
		// (pending|transcribing|transcribed|planning|planned|rendering|completed|failed).
		Action.make("SetStatus", {
			payload: { status: Schema.String },
			success: ChapterState,
		}),

		// Set the transcription status
		// (pending|running|completed|failed|skipped).
		Action.make("SetTranscriptionStatus", {
			payload: { status: Schema.String },
			success: ChapterState,
		}),

		// Start background transcription of the linked source asset.
		// Returns immediately with transcriptionStatus === "running".
		Action.make("StartTranscription", {
			success: ChapterState,
		}),

		// Return the linked pipeline id, if any.
		Action.make("GetPipelineStatus", {
			success: Schema.optional(Schema.String),
		}),
	],
});
