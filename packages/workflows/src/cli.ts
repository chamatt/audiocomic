import { config } from 'dotenv';
config({ path: '../../.env', override: true });

import { getEnv, uuid, nowIso } from '@audiocomic/shared';
import type {
  Project,
  JobRecord,
  PageSpec,
  PanelSpec,
  PanelRenderRequest,
  StorySection,
  CharacterProfile,
  WorldBible,
  SourceAsset,
  ProjectStage,
  StageState,
} from '@audiocomic/domain';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';

// ============================================================================
// AudioComic CLI — direct pipeline control without the web UI
//
//   bun run cli run <projectId>                        # enqueue pipeline job
//   bun run cli run-inline <projectId>                 # run pipeline inline (blocking)
//   bun run cli status <projectId> --watch             # live progress (polls every 2s)
//   bun run cli panels <projectId>                     # list all panels
//   bun run cli render-panel <projectId> <panelId>     # render single panel
//   bun run cli list                                    # list all projects
//
// Worker (processes enqueued jobs):
//   bun run worker                                      # start background worker

async function getRepo() {
  const { createDb, createRepository } = await import('@audiocomic/db');
  const env = getEnv();
  const dbResult = createDb(env.DATABASE_URL);
  return { repo: createRepository(dbResult.db), dbResult };
}

async function getDeps() {
  const { createPipelineDeps } = await import('./deps');
  return createPipelineDeps();
}

// ----------------------------------------------------------------------------
// Commands
// ----------------------------------------------------------------------------

async function cmdList() {
  const { repo } = await getRepo();
  const env = getEnv();
  const result = await (await getDb()).sql`SELECT * FROM projects ORDER BY created_at DESC`;
  const projects = result as unknown as Project[];
  if (projects.length === 0) {
    console.log('No projects found.');
    return;
  }
  for (const p of projects) {
    console.log(`  ${p.id}  ${p.status.padEnd(10)}  ${p.modality.padEnd(6)}  ${p.name}`);
  }
}

async function cmdCreateText(name: string, textFilePath?: string) {
  const { repo } = await getRepo();
  const env = getEnv();
  let text: string;
  if (textFilePath) {
    text = await fs.readFile(textFilePath, 'utf-8');
  } else {
    // Read from stdin (file descriptor 0)
    const chunks: Buffer[] = [];
    const fd = await fs.open('/dev/stdin', 'r');
    const buf = Buffer.alloc(65536);
    let result = await fd.read(buf, 0, 65536, null);
    while (result.bytesRead > 0) {
      chunks.push(buf.subarray(0, result.bytesRead));
      result = await fd.read(buf, 0, 65536, null);
    }
    await fd.close();
    text = Buffer.concat(chunks).toString('utf-8');
  }
  const projectId = uuid();
  const now = nowIso();
  const storageKey = `projects/${projectId}/source/book.txt`;

  // Write file
  const assetPath = join(env.UPLOAD_DIR, storageKey);
  await fs.mkdir(dirname(assetPath), { recursive: true });
  await fs.writeFile(assetPath, text, 'utf-8');

  // Create asset + project + job
  await repo.sourceAssets.create({
    id: uuid(),
    projectId,
    modality: 'text',
    filename: 'book.txt',
    mimeType: 'text/plain',
    sizeBytes: Buffer.byteLength(text),
    storageKey,
    uploadedAt: now,
  });

  const project: Project = {
    id: projectId,
    name,
    description: undefined,
    status: 'created',
    modality: 'text',
    createdAt: now,
    updatedAt: now,
    providerSettings: {
      llmProvider: 'openai',
      llmModel: env.DEFAULT_LLM_MODEL,
      ttsProvider: 'openai',
      ttsVoice: env.DEFAULT_TTS_VOICE,
      imageProvider: env.DEFAULT_RENDERER === 'aisdk' ? 'openai' : env.DEFAULT_RENDERER,
      imageModel: env.DEFAULT_IMAGE_MODEL,
      rendererBackend: env.DEFAULT_RENDERER,
      transcriptionProvider: 'openai',
    },
    stages: [],
  };
  await repo.projects.create(project);

  const job: JobRecord = {
    id: uuid(),
    projectId,
    type: 'full_pipeline',
    state: 'pending',
    progress: 0,
    payload: { modality: 'text', storageKey },
    createdAt: now,
    attempts: 0,
  };
  await repo.jobs.create(job);

  console.log(`Project created: ${projectId}`);
  console.log(`Job enqueued: ${job.id}`);
  console.log(`Run: bun run cli run ${projectId}`);
}

async function cmdCreateAudio(name: string, filePath: string) {
  const { repo } = await getRepo();
  const env = getEnv();
  const stat = await fs.stat(filePath);
  const projectId = uuid();
  const now = nowIso();
  const filename = filePath.split('/').pop() ?? 'audio.m4b';
  const storageKey = `projects/${projectId}/source/${filename}`;

  // Copy file to storage
  const assetPath = join(env.UPLOAD_DIR, storageKey);
  await fs.mkdir(dirname(assetPath), { recursive: true });
  await fs.copyFile(filePath, assetPath);

  await repo.sourceAssets.create({
    id: uuid(),
    projectId,
    modality: 'audio',
    filename,
    mimeType: 'audio/m4b',
    sizeBytes: stat.size,
    storageKey,
    uploadedAt: now,
  });

  const project: Project = {
    id: projectId,
    name,
    description: undefined,
    status: 'created',
    modality: 'audio',
    createdAt: now,
    updatedAt: now,
    providerSettings: {
      llmProvider: 'openai',
      llmModel: env.DEFAULT_LLM_MODEL,
      ttsProvider: 'openai',
      ttsVoice: env.DEFAULT_TTS_VOICE,
      imageProvider: env.DEFAULT_RENDERER === 'aisdk' ? 'openai' : env.DEFAULT_RENDERER,
      imageModel: env.DEFAULT_IMAGE_MODEL,
      rendererBackend: env.DEFAULT_RENDERER,
      transcriptionProvider: 'openai',
    },
    stages: [],
  };
  await repo.projects.create(project);

  const job: JobRecord = {
    id: uuid(),
    projectId,
    type: 'full_pipeline',
    state: 'pending',
    progress: 0,
    payload: { modality: 'audio', storageKey },
    createdAt: now,
    attempts: 0,
  };
  await repo.jobs.create(job);

  console.log(`Project created: ${projectId}`);
  console.log(`Job enqueued: ${job.id}`);
  console.log(`Run: bun run cli run ${projectId}`);
}

async function cmdRun(projectId: string) {
  const { repo } = await getRepo();
  const project = await repo.projects.getById(projectId);
  if (!project) {
    console.error(`Project not found: ${projectId}`);
    process.exit(1);
  }

  // Enqueue a job for the background worker — does not execute inline.
  const assets = await repo.sourceAssets.getByProjectId(projectId);
  const asset = assets[0];
  if (!asset) {
    console.error('No source asset found for project');
    process.exit(1);
  }
  const job: JobRecord = {
    id: uuid(),
    projectId,
    type: 'full_pipeline',
    state: 'pending',
    progress: 0,
    payload: { modality: project.modality, storageKey: asset.storageKey },
    createdAt: nowIso(),
    attempts: 0,
  };
  await repo.jobs.create(job);

  console.log(`Job enqueued: ${job.id}`);
  console.log(`Project: ${projectId}`);
  console.log('');
  console.log('The worker will pick this up automatically. To watch progress:');
  console.log(`  bun run cli status ${projectId} --watch`);
  console.log('');
  console.log('No worker running? Start one with:');
  console.log('  bun run worker');
}

async function cmdRunInline(projectId: string) {
  const { repo } = await getRepo();
  const project = await repo.projects.getById(projectId);
  if (!project) {
    console.error(`Project not found: ${projectId}`);
    process.exit(1);
  }

  // Find the pending/running job, or create one
  let jobs = await repo.jobs.getByProjectId(projectId);
  let job = jobs.find((j) => j.state === 'pending' || j.state === 'running');
  if (!job) {
    const assets = await repo.sourceAssets.getByProjectId(projectId);
    const asset = assets[0];
    if (!asset) {
      console.error('No source asset found for project');
      process.exit(1);
    }
    job = {
      id: uuid(),
      projectId,
      type: 'full_pipeline',
      state: 'pending',
      progress: 0,
      payload: { modality: project.modality, storageKey: asset.storageKey },
      createdAt: nowIso(),
      attempts: 0,
    };
    await repo.jobs.create(job);
  }

  console.log(`Running pipeline for project: ${projectId}`);
  console.log(`Job: ${job.id}`);
  console.log('---');

  const deps = await getDeps();
  const { FullPipelineHandler } = await import('./pipeline');
  const handler = new FullPipelineHandler(deps);

  const ctx = {
    projectId,
    updateProgress: async (progress: number) => {
      process.stdout.write(`\r  progress: ${Math.round(progress * 100)}%`);
    },
    updateStage: async (stage: ProjectStage, state: StageState, error?: string) => {
      if (state === 'running') {
        console.log(`\n  ▶ ${stage}`);
      } else if (state === 'completed') {
        console.log(`  ✓ ${stage}`);
      } else if (state === 'failed') {
        console.log(`  ✗ ${stage}: ${error ?? 'unknown error'}`);
      }
    },
    log: (msg: string) => console.log(`  ${msg}`),
  };

  // Mark job running
  await repo.jobs.patch(job.id, { state: 'running', startedAt: nowIso() });

  const result = await handler.execute(job, ctx);
  console.log('\n---');

  if (result.success) {
    await repo.jobs.patch(job.id, { state: 'completed', progress: 1, completedAt: nowIso() });
    await repo.projects.patch(projectId, { status: 'completed', updatedAt: nowIso() });
    console.log('Pipeline completed successfully!');
    console.log(`Stages: ${result.completedStages?.join(', ')}`);
  } else {
    await repo.jobs.patch(job.id, { state: 'failed', error: result.error });
    await repo.projects.patch(projectId, { status: 'failed', updatedAt: nowIso() });
    console.error(`Pipeline failed: ${result.error}`);
    process.exit(1);
  }
}

async function cmdStatus(projectId: string, watch = false) {
  if (watch) {
    await cmdWatch(projectId);
    return;
  }
  await printStatus(projectId);
}

async function cmdWatch(projectId: string) {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  let lastStageKey = '';
  let stableCount = 0;
  const STALL_THRESHOLD = 60; // 60 polls × 2s = 120s with no change = stall

  // Create a single repo instance and reuse it for all polls
  const { repo } = await getRepo();

  while (true) {
    const project = await repo.projects.getById(projectId);
    if (!project) {
      console.error(`Project not found: ${projectId}`);
      process.exit(1);
    }

    const jobs = await repo.jobs.getByProjectId(projectId);
    const job = jobs.find((j) => j.state === 'pending' || j.state === 'running') ?? jobs[0];
    const runningStage = project.stages.find((s) => s.state === 'running');
    const stageKey = project.stages.map((s) => `${s.stage}:${s.state}`).join('|');

    // Detect stall: same stage state for too long while job is running
    if (job?.state === 'running') {
      if (stageKey === lastStageKey) {
        stableCount++;
      } else {
        stableCount = 0;
        lastStageKey = stageKey;
      }
    }

    // Clear screen and print fresh status
    process.stdout.write('\x1B[2J\x1B[H');
    console.log(`Project: ${project.name} (${projectId})`);
    console.log(`Status: ${project.status}`);
    console.log('');
    console.log('Stages:');
    for (const s of project.stages) {
      const icon = s.state === 'completed' ? '✓' : s.state === 'running' ? '▶' : s.state === 'failed' ? '✗' : '○';
      console.log(`  ${icon} ${s.stage.padEnd(20)} ${s.state}${s.error ? ` — ${s.error}` : ''}`);
    }
    console.log('');
    if (job) {
      const pct = Math.round((job.progress ?? 0) * 100);
      const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
      console.log(`Job [${job.id.slice(0, 8)}] ${job.type} — ${job.state} ${bar} ${pct}%`);
      if (job.error) console.log(`  Error: ${job.error}`);
    }

    // Stall warning
    if (stableCount >= STALL_THRESHOLD) {
      console.log('');
      console.log(`⚠ STALL DETECTED: no stage change for ${stableCount * 2}s while job is running.`);
      console.log(`  Stuck on: ${runningStage?.stage ?? 'unknown'}`);
      console.log('  The worker may be waiting on an API call or has crashed.');
      console.log('  Check: bun run worker logs, or kill and restart the worker.');
    }

    // Exit when job reaches terminal state
    if (job && (job.state === 'completed' || job.state === 'failed')) {
      console.log('');
      if (job.state === 'completed') {
        console.log('✓ Pipeline completed!');
      } else {
        console.log(`✗ Pipeline failed: ${job.error ?? 'unknown'}`);
      }
      break;
    }

    await sleep(2000);
  }
}

async function printStatus(projectId: string) {
  const { repo } = await getRepo();
  const project = await repo.projects.getById(projectId);
  if (!project) {
    console.error(`Project not found: ${projectId}`);
    process.exit(1);
  }

  console.log(`Project: ${project.name}`);
  console.log(`  ID: ${project.id}`);
  console.log(`  Status: ${project.status}`);
  console.log(`  Modality: ${project.modality}`);
  console.log(`  Stages:`);
  for (const s of project.stages) {
    const icon = s.state === 'completed' ? '✓' : s.state === 'running' ? '▶' : s.state === 'failed' ? '✗' : '○';
    console.log(`    ${icon} ${s.stage}: ${s.state}${s.error ? ` (${s.error})` : ''}`);
  }

  const sections = await repo.storySections.getByProjectId(projectId);
  console.log(`\n  Story sections: ${sections.length}`);
  for (const s of sections) {
    console.log(`    [${s.id.slice(0, 8)}] ${s.title ?? 'untitled'} — ${s.summary.slice(0, 60)}`);
  }

  const characters = await repo.characterProfiles.getByProjectId(projectId);
  console.log(`\n  Characters: ${characters.length}`);
  for (const c of characters) {
    console.log(`    [${c.id.slice(0, 8)}] ${c.name} — ${c.description?.slice(0, 60) ?? ''}`);
  }

  const pages = await repo.pageSpecs.getByProjectId(projectId);
  console.log(`\n  Pages: ${pages.length}`);
  for (const p of pages) {
    const panels = await repo.panelSpecs.getByProjectId(projectId);
    const pagePanels = panels.filter((pn) => pn.pageId === p.id);
    console.log(`    Page ${p.index}: ${pagePanels.length} panels, layoutValid=${p.layoutValid}`);
  }

  const jobs = await repo.jobs.getByProjectId(projectId);
  console.log(`\n  Jobs: ${jobs.length}`);
  for (const j of jobs) {
    console.log(`    [${j.id.slice(0, 8)}] ${j.type} — ${j.state} (${Math.round((j.progress ?? 0) * 100)}%)${j.error ? ` err: ${j.error}` : ''}`);
  }
}

async function cmdPanels(projectId: string) {
  const { repo } = await getRepo();
  const panels = await repo.panelSpecs.getByProjectId(projectId);
  if (panels.length === 0) {
    console.log('No panels found. Run the pipeline first.');
    return;
  }

  console.log(`Panels for project ${projectId}:`);
  console.log('');
  for (const p of panels) {
    const rendered = p.renderResultId ? '✓' : '○';
    const prompt = p.renderPrompt ? `${p.renderPrompt.slice(0, 80)}...` : '(no prompt)';
    console.log(`  ${rendered} [${p.id}] page=${p.pageId.slice(0, 8)} idx=${p.index}`);
    console.log(`    prompt: ${prompt}`);
    console.log(`    characters: ${p.characters.map((c) => c.characterId.slice(0, 8)).join(', ') || 'none'}`);
    console.log(`    dialogue: ${p.dialogueLines.length} lines`);
    console.log('');
  }
}

async function cmdRenderPanel(projectId: string, panelId: string) {
  const { repo } = await getRepo();
  const deps = await getDeps();
  const panel = await repo.panelSpecs.getById(panelId);
  if (!panel) {
    console.error(`Panel not found: ${panelId}`);
    process.exit(1);
  }

  console.log(`Rendering panel: ${panelId}`);
  console.log(`  Prompt: ${panel.renderPrompt?.slice(0, 100) ?? '(none)'}`);

  const characters = await repo.characterProfiles.getByProjectId(projectId);
  const renderReq: PanelRenderRequest = {
    id: uuid(),
    panelId: panel.id,
    projectId,
    prompt: panel.renderPrompt ?? 'placeholder',
    negativePrompt: panel.renderNegativePrompt,
    seed: panel.seed ?? Math.floor(Math.random() * 1_000_000_000),
    width: 768,
    height: 1024,
    version: 0,
    createdAt: nowIso(),
    referenceImageKeys: characters
      .filter((c) => panel.characters.some((pc) => pc.characterId === c.id))
      .flatMap((c) => [c.canonicalFaceRef, c.canonicalBodyRef].filter((k): k is string => !!k)),
  };

  await repo.panelRenderRequests.create(renderReq);
  console.log('  Calling renderer...');
  const result = await deps.renderPanel(renderReq);
  console.log(`  Result: ${result.id}`);
  console.log(`  Image key: ${result.imageKey}`);
  console.log(`  Seed: ${result.seed}`);

  await repo.panelRenderResults.create(result);
  await repo.panelSpecs.patch(panel.id, {
    renderResultId: result.id,
    seed: result.seed ?? renderReq.seed,
  });

  console.log('Panel rendered successfully!');
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

async function getDb() {
  const { createDb } = await import('@audiocomic/db');
  const env = getEnv();
  return createDb(env.DATABASE_URL);
}

async function main() {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case 'list':
      await cmdList();
      break;
    case 'create-text':
      if (!args[0]) {
        console.error('Usage: cli create-text "Project Name" [textfile.txt]');
        process.exit(1);
      }
      await cmdCreateText(args[0], args[1]);
      break;
    case 'create-audio':
      if (!args[0] || !args[1]) {
        console.error('Usage: cli create-audio "Project Name" /path/to/file.m4b');
        process.exit(1);
      }
      await cmdCreateAudio(args[0], args[1]);
      break;
    case 'run':
      if (!args[0]) {
        console.error('Usage: cli run <projectId>');
        process.exit(1);
      }
      await cmdRun(args[0]);
      break;
    case 'run-inline':
      if (!args[0]) {
        console.error('Usage: cli run-inline <projectId>');
        process.exit(1);
      }
      await cmdRunInline(args[0]);
      break;
    case 'status':
      if (!args[0]) {
        console.error('Usage: cli status <projectId> [--watch]');
        process.exit(1);
      }
      await cmdStatus(args[0], args.includes('--watch') || args.includes('-w'));
      break;
    case 'panels':
      if (!args[0]) {
        console.error('Usage: cli panels <projectId>');
        process.exit(1);
      }
      await cmdPanels(args[0]);
      break;
    case 'render-panel':
      if (!args[0] || !args[1]) {
        console.error('Usage: cli render-panel <projectId> <panelId>');
        process.exit(1);
      }
      await cmdRenderPanel(args[0], args[1]);
      break;
    default:
      console.log(`AudioComic CLI

Usage:
  cli create-text "Name" [textfile.txt]        Create a text project (file or stdin)
  cli create-audio "Name" /path/to/file.m4b   Create an audio project
  cli run <projectId>                         Enqueue pipeline job for worker
  cli run-inline <projectId>                  Run pipeline inline (blocking)
  cli status <projectId> [--watch]            Show project state (live watch mode)
  cli panels <projectId>                      List all panels with status
  cli render-panel <projectId> <panelId>      Re-render a single panel
`);
      break;
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('CLI error:', err);
  process.exit(1);
});
