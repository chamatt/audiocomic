import { Effect } from "effect";
import { PipelineBridge } from "../../../lib/pipeline-bridge.ts";
import { registerStep, type StepExecutor, type StepContext, type StepOutput } from "./types.ts";
import { getPrevResult, isComposePagesResult } from "./helpers.ts";
import { uuid, nowIso, exportKey } from "@audiocomic/shared";
import type { ExportBundle } from "@audiocomic/domain";

// ─── export_static step ───
// Bundles the composed page images into a PDF document.
// Reads the pageImageKeys map from the compose_pages result, exports
// via the media adapter's exportPdf (pdf-lib), and persists an
// ExportBundle record.

export interface ExportStaticResult {
	step: "export_static";
	status: "completed";
	exportId: string;
	sizeBytes: number;
}

export const ExportStaticStep: StepExecutor = {
	type: "export_static",
	inputs: ["compose_pages"],
	outputs: ["export_static"],
	execute: (ctx: StepContext) =>
		Effect.gen(function* () {
			const bridge = yield* PipelineBridge;

			// Read compose_pages result for the pageImageKeys map.
			const composePages = yield* getPrevResult(ctx, "compose_pages", isComposePagesResult);
			const pageImageKeys = composePages.pageImageKeys;

			// Collect all page image keys as an array.
			const pageImageKeyArray = Array.from(pageImageKeys.values());

			if (pageImageKeyArray.length === 0) {
				return yield* Effect.fail(
					new Error("export_static: no composed page images available to export"),
				);
			}

			const exportId = uuid();
			// Build the export bundle.
			const key = exportKey(ctx.projectId, exportId, "pdf");
			const localPath = `${bridge.env.EXPORT_DIR}/${key}`;

			const result = yield* Effect.tryPromise({
				try: () => bridge.exportPdf(pageImageKeyArray, localPath),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			// Persist the ExportBundle record.
			const bundle: ExportBundle = {
				id: exportId,
				projectId: ctx.projectId,
				type: "pages",
				storageKey: key,
				createdAt: nowIso(),
				sizeBytes: result.sizeBytes,
				metadata: {},
			};
			yield* Effect.tryPromise({
				try: () => bridge.repo.exportBundles.create(bundle),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			});

			yield* Effect.logInfo(
				`export_static: exported ${pageImageKeyArray.length} pages to ${key} (${result.sizeBytes} bytes)`,
			);

			return {
				inputHash: ctx.inputHash ?? "",
				data: {
					step: "export_static" as const,
					status: "completed" as const,
					exportId,
					sizeBytes: result.sizeBytes,
				} satisfies ExportStaticResult,
				summary: `Exported ${result.sizeBytes} bytes`,
			} satisfies StepOutput;
		}),
};

registerStep(ExportStaticStep);
