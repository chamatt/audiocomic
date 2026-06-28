import { Schema } from "effect";
import { Action, Actor } from "@rivetkit/effect";

/**
 * Knowledge base status — the actor's durable projection of ingestion
 * progress for one project.
 *
 * `embeddingStatus` and `wikiStatus` map a chapter id to a lifecycle
 * state (`pending` | `running` | `completed` | `failed` | `skipped`).
 * `lastLintAt` records the timestamp of the most recent `Lint` run, and
 * `contradictionCount` caches the contradiction count from that run so
 * clients can surface a stale-wiki badge without re-linting.
 */
export const KnowledgeBaseStatus = Schema.Struct({
	projectId: Schema.String,
	embeddingStatus: Schema.Record(Schema.String, Schema.String),
	wikiStatus: Schema.Record(Schema.String, Schema.String),
	lastLintAt: Schema.optional(Schema.Number),
	contradictionCount: Schema.Number,
});
export type KnowledgeBaseStatus = Schema.Schema.Type<typeof KnowledgeBaseStatus>;

/** One vector-search hit returned by `Query`. */
export const KnowledgeSearchResult = Schema.Struct({
	text: Schema.String,
	score: Schema.Number,
	metadata: Schema.Unknown,
});
export type KnowledgeSearchResult = Schema.Schema.Type<typeof KnowledgeSearchResult>;

/** One wiki page returned by `GetWiki`. */
export const WikiPageSummary = Schema.Struct({
	id: Schema.String,
	type: Schema.String,
	title: Schema.String,
	content: Schema.String,
	confidence: Schema.Number,
});
export type WikiPageSummary = Schema.Schema.Type<typeof WikiPageSummary>;

/** Lint report returned by `Lint`. */
export const KnowledgeLintReport = Schema.Struct({
	contradictions: Schema.Array(Schema.String),
	orphanPages: Schema.Array(Schema.String),
	gaps: Schema.Array(Schema.String),
	recommendations: Schema.Array(Schema.String),
});
export type KnowledgeLintReport = Schema.Schema.Type<typeof KnowledgeLintReport>;

/** One per-chapter character state entry in a timeline. */
export const CharacterTimelineEntry = Schema.Struct({
	chapterId: Schema.String,
	chapterIndex: Schema.Number,
	outfit: Schema.optional(Schema.String),
	location: Schema.optional(Schema.String),
	mood: Schema.optional(Schema.String),
	notes: Schema.optional(Schema.String),
});
export type CharacterTimelineEntry = Schema.Schema.Type<typeof CharacterTimelineEntry>;

/**
 * KnowledgeBase actor contract.
 *
 * One KnowledgeBase instance per project, keyed by project id. It
 * coordinates the two ingestion paths that feed the project's knowledge
 * base — transcript embedding (RAG) and wiki entity extraction — and
 * exposes read-only query, wiki, lint, and character-timeline views.
 *
 * `IngestChapter` kicks off both paths as background daemon fibers and
 * returns immediately with the chapter marked `running`; the fibers
 * flip the per-chapter status to `completed` (or `failed` on error) and
 * broadcast `knowledgeBaseUpdated` when done.
 */
export const KnowledgeBase = Actor.make("KnowledgeBase", {
	actions: [
		// Run the embedding + wiki ingest pipeline for one chapter.
		// Returns immediately with the chapter marked "running".
		Action.make("IngestChapter", {
			payload: { chapterId: Schema.String },
			success: KnowledgeBaseStatus,
		}),

		// Read the current knowledge base status for this project.
		Action.make("GetStatus", {
			success: KnowledgeBaseStatus,
		}),

		// Vector-search the knowledge base for the top-K most relevant
		// transcript segments.
		Action.make("Query", {
			payload: {
				query: Schema.String,
				topK: Schema.optional(Schema.Number),
			},
			success: Schema.Array(KnowledgeSearchResult),
		}),

		// Read all wiki pages for this project.
		Action.make("GetWiki", {
			success: Schema.Array(WikiPageSummary),
		}),

		// Lint the wiki for contradictions, orphans, and gaps.
		Action.make("Lint", {
			success: KnowledgeLintReport,
		}),

		// Read the per-chapter state timeline for one character.
		Action.make("GetCharacterTimeline", {
			payload: { characterId: Schema.String },
			success: Schema.Array(CharacterTimelineEntry),
		}),
	],
});
