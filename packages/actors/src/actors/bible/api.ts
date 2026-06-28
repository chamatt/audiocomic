import { Action, Actor } from "@rivetkit/effect";
import { Schema } from "effect";
import { BibleContent } from "../../lib/schemas.ts";

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
	],
});
