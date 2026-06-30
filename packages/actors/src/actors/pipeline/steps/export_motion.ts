import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import {
	getPrevResult,
	isComposePagesResult,
} from "./helpers.ts";
import { uuid, nowIso, exportKey } from "@audiocomic/shared";
import type {
	NarrationTimeline,
	NarrationSegment,
	ExportBundle,
	PageSpec,
	PanelSpec,
} from "@audiocomic/domain";

// ─── export_motion step ───
// Builds a NarrationTimeline from the planned pages/panels (one ken-burns
// segment per panel), persists it, then renders an MP4 motion comic via the
// media adapter. Page images are read from storage into a Map keyed by pageId.
// If the source modality is audio, the normalized audio path is passed as the
// narration track; otherwise audioPath is undefined.

export interface ExportMotionResult {
	step: "export_motion";
	status: "completed";
	exportId: string;
	sizeBytes: number;
	durationSec: number;
}

// Safe narrowing of the DB rows returned by pageSpecs/panelSpecs. A panel
// must carry the fields the timeline builder reads: id, pageId, description,
// and optional startSec/endSec. A page must carry an id.
const isPanelLike = (v: unknown): v is PanelSpec =>
	typeof v === "object" &&
	v !== null &&
	"id" in v &&
	typeof (v as Record<string, unknown>).id === "string" &&
	"pageId" in v &&
	typeof (v as Record<string, unknown>).pageId === "string" &&
	"description" in v &&
	typeof (v as Record<string, unknown>).description === "string";

const isPageLike = (v: unknown): v is PageSpec =>
	typeof v === "object" &&
	v !== null &&
	"id" in v &&
	typeof (v as Record<string, unknown>).id === "string";

export const ExportMotionStep: StepExecutor = {
	type: "export_motion",
	inputs: ["compose_pages"],
	outputs: ["export_motion"],
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Read previous step results.
			const composePages = yield* getPrevResult(ctx, "compose_pages", isComposePagesResult);

			// Read pages and panels from the DB (plan_chapters persists them).
			const rawPages = yield* Effect.tryPromise({
				try: () => bridge.repo.pageSpecs.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});
			const rawPanels = yield* Effect.tryPromise({
				try: () => bridge.repo.panelSpecs.getByProjectId(ctx.projectId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			// Narrow the DB rows safely.
			const pages: PageSpec[] = [];
			for (const p of rawPages) {
				if (!isPageLike(p)) {
					return yield* Effect.fail(
						new Error("export_motion: pageSpecs row missing string 'id' field"),
					);
				}
				pages.push(p);
			}
			const allPanels: PanelSpec[] = [];
			for (const p of rawPanels) {
				if (!isPanelLike(p)) {
					return yield* Effect.fail(
						new Error(
							"export_motion: panelSpecs row missing id/pageId/description fields",
						),
					);
				}
				allPanels.push(p);
			}

			// Build the narration timeline: one ken-burns segment per panel,
			// ordered by page then panel. Timing falls back to even distribution
			// when panel.startSec/endSec are absent or broken (inverted).
			const validPanels = allPanels.filter(
				(p) => p.startSec != null && p.endSec != null && p.endSec > p.startSec,
			);
			const useTimestamps = validPanels.length > 0;
			const evenDur = useTimestamps
				? 0 // unused when timestamps are valid
				: 5; // 5s per panel when no valid timestamps

			const segments: NarrationSegment[] = [];
			let currentTime = 0;
			for (const page of pages) {
				const pagePanels = allPanels
					.filter((p) => p.pageId === page.id)
					.sort((a, b) => a.index - b.index);
				for (const panel of pagePanels) {
					let start: number;
					let end: number;
					if (
						useTimestamps &&
						panel.startSec != null &&
						panel.endSec != null &&
						panel.endSec > panel.startSec
					) {
						start = panel.startSec;
						end = panel.endSec;
					} else {
						start = currentTime;
						end = start + evenDur;
					}
					segments.push({
						panelId: panel.id,
						pageId: page.id,
						startSec: start,
						endSec: end,
						motion: "ken-burns",
						motionParams: {
							zoomStart: 1.0,
							zoomEnd: 1.15,
							panX: 0,
							panY: 0,
						},
						text: panel.description,
					});
					currentTime = end;
				}
			}

			if (segments.length === 0) {
				yield* Effect.logInfo(
					"export_motion: no panels to animate — skipping motion export",
				);
				return {
					inputHash: ctx.inputHash ?? "",
					data: {
						step: "export_motion" as const,
						status: "completed" as const,
						exportId: "",
						sizeBytes: 0,
						durationSec: 0,
					} satisfies ExportMotionResult,
					summary: `Exported 0 bytes, 0s`,
				} satisfies StepOutput;
			}

			const timeline: NarrationTimeline = {
				id: uuid(),
				projectId: ctx.projectId,
				segments,
				totalDurationSec: currentTime,
				ttsGenerated: false,
			};

			// Persist the timeline.
			yield* Effect.tryPromise({
				try: () => bridge.repo.narrationTimelines.create(timeline),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			// Audio narration track: chapters store audio in blob storage.
			// For now, motion export proceeds without a narration track;
			// chapter audio download can be added when TTS/narration is wired.
			const audioPath: string | undefined = undefined;

			// Build the page image map by reading each composed page image from
			// storage. Only pages present in compose_pages' pageImageKeys are
			// included; the motion adapter throws if a segment's pageId is
			// missing from the map.
			const pageImageMap = new Map<string, Buffer>();
			for (const [pageId, imageKey] of composePages.pageImageKeys) {
				const buf = yield* Effect.tryPromise({
					try: () => bridge.storage.readAsset(imageKey),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				});
				pageImageMap.set(pageId, buf);
			}

			// Render the motion comic to the export directory.
			const motionExportId = uuid();
			const motionKey = exportKey(ctx.projectId, motionExportId, "mp4");
			const motionLocalPath = `${bridge.env.EXPORT_DIR}/${motionKey}`;

			const motionResult = yield* Effect.tryPromise({
				try: () =>
					bridge.exportMotionComic(
						timeline as never,
						pageImageMap,
						audioPath,
						motionLocalPath,
					),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			// Persist the export bundle record.
			const motionBundle: ExportBundle = {
				id: motionExportId,
				projectId: ctx.projectId,
				type: "mp4",
				storageKey: motionKey,
				createdAt: nowIso(),
				sizeBytes: motionResult.sizeBytes,
				metadata: { durationSec: motionResult.durationSec },
			};
			yield* Effect.tryPromise({
				try: () => bridge.repo.exportBundles.create(motionBundle),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			yield* Effect.logInfo(
				`export_motion: rendered motion comic ${motionExportId} — ${motionResult.sizeBytes} bytes, ${motionResult.durationSec}s`,
			);

			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "export_motion" as const,
					status: "completed" as const,
					exportId: motionExportId,
					sizeBytes: motionResult.sizeBytes,
					durationSec: motionResult.durationSec,
				} satisfies ExportMotionResult,
				summary: `Exported ${motionResult.sizeBytes} bytes, ${motionResult.durationSec}s`,
			} satisfies StepOutput;
		}),
};

registerStep(ExportMotionStep);
