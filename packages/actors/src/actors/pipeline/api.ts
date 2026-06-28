import { Action, Actor } from "@rivetkit/effect";
import { Schema } from "effect";
import {
	CronSchedule,
	PipelineStatus,
	StepDefinition,
	StepState,
} from "../../lib/schemas.ts";

// ---------------------------------------------------------------------------
// State schema
// ---------------------------------------------------------------------------

/**
 * Persisted state of a Pipeline actor.
 *
 * - `status`  — high-level lifecycle of the whole pipeline.
 * - `steps`   — ordered list of step states, mirroring the execution plan.
 * - `schedule`— optional cron schedule for recurring runs.
 */
export const PipelineState = Schema.Struct({
	status: PipelineStatus,
	steps: Schema.Array(StepState),
	schedule: Schema.optional(CronSchedule),
});
export type PipelineState = Schema.Schema.Type<typeof PipelineState>;

// ---------------------------------------------------------------------------
// Action payloads
// ---------------------------------------------------------------------------

const AddStepPayload = Schema.Struct({
	step: StepDefinition,
});

const RemoveStepPayload = Schema.Struct({
	stepId: Schema.String,
});

const RetryStepPayload = Schema.Struct({
	stepId: Schema.String,
});

const SkipStepPayload = Schema.Struct({
	stepId: Schema.String,
});

const RunStepPayload = Schema.Struct({
	stepId: Schema.String,
});

const GetStepResultPayload = Schema.Struct({
	stepId: Schema.String,
});

const GetStepLogsPayload = Schema.Struct({
	stepId: Schema.String,
});

const InvalidateStepPayload = Schema.Struct({
	stepId: Schema.String,
});

const SchedulePayload = Schema.Struct({
	intervalMs: Schema.Number,
});

// ---------------------------------------------------------------------------
// Actor contract
// ---------------------------------------------------------------------------

/**
 * `Pipeline` actor: an ordered, resumable step runner with retry, skip,
 * pause/resume, and cron scheduling. Each step is dispatched to a registered
 * `StepExecutor` (see `./steps/types.ts`) keyed by `StepDefinition.type`.
 */
export const Pipeline = Actor.make("pipeline", {
	actionTimeoutMs: 600_000, // 10 minutes — long-running steps like plan_story can take 90-250s
	actions: [
		Action.make("AddStep", {
			payload: AddStepPayload,
			success: Schema.Array(StepState),
		}),
		Action.make("RemoveStep", {
			payload: RemoveStepPayload,
			success: Schema.Array(StepState),
		}),
		Action.make("GetStatus", {
			success: PipelineState,
		}),
		Action.make("Start", {
			success: PipelineStatus,
		}),
		Action.make("Pause", {
			success: PipelineStatus,
		}),
		Action.make("Resume", {
			success: PipelineStatus,
		}),
		Action.make("RetryStep", {
			payload: RetryStepPayload,
			success: StepState,
		}),
		Action.make("SkipStep", {
			payload: SkipStepPayload,
			success: StepState,
		}),
		Action.make("RunStep", {
			payload: RunStepPayload,
			success: StepState,
		}),
		Action.make("GetStepResult", {
			payload: GetStepResultPayload,
			success: Schema.Unknown,
		}),
		Action.make("GetStepLogs", {
			payload: GetStepLogsPayload,
			success: Schema.Array(Schema.Unknown),
		}),
		Action.make("InvalidateStep", {
			payload: InvalidateStepPayload,
			success: Schema.Array(StepState),
		}),
		Action.make("Schedule", {
			payload: SchedulePayload,
			success: CronSchedule,
		}),
		Action.make("CancelSchedule", {
			success: Schema.Boolean,
		}),
		// Internal: invoked by `rawRivetkitContext.schedule.after` on each
		// cron tick. Not intended for direct client use.
		Action.make("_cronTick", {
			success: PipelineStatus,
		}),
	],
});
