import { Schema } from "effect";

// Re-export domain types as Effect schemas for actor state
// These map to the existing @audiocomic/domain Zod schemas

export const StepStatus = Schema.Literals([
	"pending", "running", "paused", "completed", "failed", "skipped", "stale",
]);
export type StepStatus = Schema.Schema.Type<typeof StepStatus>;

export const RetryPolicy = Schema.Struct({
	maxRetries: Schema.Number,
	backoffMs: Schema.Number,
	backoffFactor: Schema.Number,
	timeoutMs: Schema.optional(Schema.Number),
});
export type RetryPolicy = Schema.Schema.Type<typeof RetryPolicy>;

export const StepDefinition = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	type: Schema.String,
	config: Schema.Record(Schema.String, Schema.Unknown),
	dependsOn: Schema.Array(Schema.String),
	retryPolicy: Schema.optional(RetryPolicy),
});
export type StepDefinition = Schema.Schema.Type<typeof StepDefinition>;

export const StepState = Schema.Struct({
	definition: StepDefinition,
	status: StepStatus,
	startedAt: Schema.optional(Schema.Number),
	completedAt: Schema.optional(Schema.Number),
	error: Schema.optional(Schema.String),
	attempts: Schema.Number,
	result: Schema.optional(Schema.Unknown),
	/** Hash of upstream inputs when this step last ran (for stale detection). */
	inputHash: Schema.optional(Schema.String),
	/** Human-readable summary of the step's output (for UI display). */
	summary: Schema.optional(Schema.String),
	/** Recent progress events (ring buffer, last 100). */
	progressEvents: Schema.optional(Schema.Array(Schema.Unknown)),
});
export type StepState = Schema.Schema.Type<typeof StepState>;

export const PipelineStatus = Schema.Literals([
	"idle", "running", "paused", "completed", "failed", "scheduled",
]);
export type PipelineStatus = Schema.Schema.Type<typeof PipelineStatus>;

export const CronSchedule = Schema.Struct({
	enabled: Schema.Boolean,
	intervalMs: Schema.Number,
	nextRunAt: Schema.optional(Schema.Number),
});
export type CronSchedule = Schema.Schema.Type<typeof CronSchedule>;

export const FileMetadata = Schema.Struct({
	id: Schema.String,
	originalName: Schema.String,
	storageKey: Schema.String,
	mimeType: Schema.String,
	sizeBytes: Schema.Number,
	uploadedAt: Schema.Number,
	tags: Schema.Array(Schema.String),
	projectId: Schema.optional(Schema.String),
});
export type FileMetadata = Schema.Schema.Type<typeof FileMetadata>;

export const BibleContent = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	lore: Schema.String,
	characters: Schema.Array(Schema.Struct({
		name: Schema.String,
		description: Schema.String,
	})),
	chapters: Schema.Array(Schema.Struct({
		id: Schema.String,
		title: Schema.String,
		summary: Schema.String,
	})),
	updatedAt: Schema.Number,
});
export type BibleContent = Schema.Schema.Type<typeof BibleContent>;

export const ProjectConfig = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	description: Schema.String,
	bibleId: Schema.optional(Schema.String),
	pipelineIds: Schema.Array(Schema.String),
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
});
export type ProjectConfig = Schema.Schema.Type<typeof ProjectConfig>;
