// Barrel entry for @audiocomic/actors.
//
// Re-exports the Rivet actor *contracts* (schemas + action definitions) and
// the shared domain schemas so consumers — primarily the web app's Rivet
// client — can import typed actors without pulling in the server-side live
// implementations (which require Storage / FFmpeg / Registry services).
//
// Server code should continue to import the `./actors/*/live.ts` modules
// directly.

export { FileRegistry } from "./actors/file-registry/api.ts";
export { Bible } from "./actors/bible/api.ts";
export { Project } from "./actors/project/api.ts";
export { Pipeline, PipelineState } from "./actors/pipeline/api.ts";
export type { PipelineState as PipelineStateType } from "./actors/pipeline/api.ts";

export {
	StepStatus,
	StepDefinition,
	StepState,
	PipelineStatus,
	CronSchedule,
	FileMetadata,
	BibleContent,
	ProjectConfig,
	RetryPolicy,
} from "./lib/schemas.ts";

export type {
	StepStatus as StepStatusType,
	StepDefinition as StepDefinitionType,
	StepState as StepStateType,
	PipelineStatus as PipelineStatusType,
	CronSchedule as CronScheduleType,
	FileMetadata as FileMetadataType,
	BibleContent as BibleContentType,
	ProjectConfig as ProjectConfigType,
	RetryPolicy as RetryPolicyType,
} from "./lib/schemas.ts";
