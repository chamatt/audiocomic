import { Schema } from "effect";
import { Action, Actor } from "@rivetkit/effect";

import { ProjectConfig } from "../../lib/schemas.ts";

/**
 * Project actor — owns the mutable configuration for one AudioComic
 * project (name, description, linked bible, and the set of pipeline
 * ids attached to it). All mutating actions return the full
 * `ProjectConfig` so callers can reconcile against a single source of
 * truth.
 */
export const Project = Actor.make("Project", {
	actions: [
		// Read the current project configuration.
		Action.make("GetConfig", {
			success: ProjectConfig,
		}),

		// Update the human-readable project name.
		Action.make("UpdateName", {
			payload: { name: Schema.String },
			success: ProjectConfig,
		}),

		// Update the human-readable project description.
		Action.make("UpdateDescription", {
			payload: { description: Schema.String },
			success: ProjectConfig,
		}),

		// Link a Bible actor to this project by id.
		Action.make("SetBible", {
			payload: { bibleId: Schema.String },
			success: ProjectConfig,
		}),

		// Attach a Pipeline actor to this project by id.
		Action.make("AddPipeline", {
			payload: { pipelineId: Schema.String },
			success: ProjectConfig,
		}),

		// Detach a Pipeline actor from this project by id.
		Action.make("RemovePipeline", {
			payload: { pipelineId: Schema.String },
			success: ProjectConfig,
		}),
	],
});
