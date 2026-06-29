// Import all step executors to trigger registration with the step registry.
// Each module calls `registerStep` at import time, populating the global registry
// consulted by `getStepExecutor` / `listStepTypes`.

import "./ingest_knowledge.ts";
import "./build_bibles.ts";
import "./generate_refs.ts";
import "./layout_panels.ts";
import "./plan_chapters.ts";
import "./render_panels.ts";
import "./panel_qa.ts";
import "./compose_pages.ts";
import "./lettering.ts";
import "./export_static.ts";
import "./export_motion.ts";

export { listStepTypes, getStepExecutor, registerStep } from "./types.ts";
export type { StepExecutor, StepContext } from "./types.ts";
