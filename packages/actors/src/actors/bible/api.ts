import { Action, Actor } from "@rivetkit/effect";
import { Schema } from "effect";
import { BibleContent, WikiPage } from "../../lib/schemas.ts";

/**
 * Bible actor contract.
 *
 * Holds the shared world/character bible for a project: lore text,
 * character roster, and chapter summaries. Every mutating action
 * returns the full updated {@link BibleContent} so callers can refresh
 * local state without a follow-up read.
 */
export const Bible = Actor.make("bible", {
	actions: [
		// Read the current bible content.
		Action.make("GetContent", {
			success: BibleContent,
		}),

		// Replace the lore text.
		Action.make("UpdateLore", {
			payload: { lore: Schema.String },
			success: BibleContent,
		}),

		// Append a character to the roster.
		Action.make("AddCharacter", {
			payload: {
				name: Schema.String,
				description: Schema.String,
			},
			success: BibleContent,
		}),

		// Append a chapter summary.
		Action.make("AddChapter", {
			payload: {
				id: Schema.String,
				title: Schema.String,
				summary: Schema.String,
			},
			success: BibleContent,
		}),

		// Patch an existing chapter by id. Either field is optional.
		Action.make("UpdateChapter", {
			payload: {
				id: Schema.String,
				title: Schema.optional(Schema.String),
				summary: Schema.optional(Schema.String),
			},
			success: BibleContent,
		}),

		// Add or update a character's state at a specific point in the timeline.
		// Replaces any existing entry for the same (characterId, chapterId) pair.
		Action.make("UpdateCharacterState", {
			payload: {
				characterId: Schema.String,
				characterName: Schema.String,
				chapterId: Schema.String,
				chapterIndex: Schema.Number,
				outfit: Schema.optional(Schema.String),
				location: Schema.optional(Schema.String),
				mood: Schema.optional(Schema.String),
				notes: Schema.optional(Schema.String),
			},
			success: BibleContent,
		}),

		// Return the ordered timeline of states for a single character.
		Action.make("GetCharacterTimeline", {
			payload: { characterId: Schema.String },
			success: Schema.Array(Schema.Struct({
				chapterId: Schema.String,
				chapterIndex: Schema.Number,
				outfit: Schema.optional(Schema.String),
				location: Schema.optional(Schema.String),
				mood: Schema.optional(Schema.String),
				notes: Schema.optional(Schema.String),
			})),
		}),

		// Merge knowledge extracted from a chapter: upsert characters into the
		// roster, upsert per-character state, and dedupe wiki pages by title.
		Action.make("MergeChapterKnowledge", {
			payload: {
				chapterId: Schema.String,
				chapterIndex: Schema.optional(Schema.Number),
				characters: Schema.Array(Schema.Struct({
					name: Schema.String,
					description: Schema.String,
					state: Schema.optional(Schema.Struct({
						outfit: Schema.optional(Schema.String),
						location: Schema.optional(Schema.String),
						mood: Schema.optional(Schema.String),
						notes: Schema.optional(Schema.String),
					})),
				})),
				wikiPages: Schema.Array(Schema.Struct({
					type: Schema.String,
					title: Schema.String,
					content: Schema.String,
				})),
			},
			success: BibleContent,
		}),

		// Return all wiki pages currently stored in the bible.
		Action.make("GetWiki", {
			success: Schema.Array(WikiPage),
		}),
	],
});
