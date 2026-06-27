import { getEnv, uuid, nowIso } from '@audiocomic/shared';
import type { Project, JobRecord } from '@audiocomic/domain';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';

// ============================================================================
// Seed script — creates a demo project with sample text and enqueues a job
// ============================================================================

const SAMPLE_TEXT = `Chapter 1: The Arrival

The old lighthouse stood at the edge of the cliff, its beam cutting through the fog like a sword of light. Mara had not been home in ten years, but the island remembered her. The wind carried the scent of salt and pine, and the waves crashed against the rocks below with a rhythm she felt in her bones.

She climbed the winding path to the lighthouse door. The paint was peeling, the brass handle tarnished, but the structure was sound. Her grandfather had kept it running for forty years before he passed. Now it was hers.

Inside, the spiral staircase wound upward into darkness. She placed her hand on the cold iron railing and began to climb. Each step echoed in the empty tower. At the top, the great lamp sat dormant, its lens covered with dust.

Mara wiped the lens with her sleeve and pulled the starter cord. The engine coughed, sputtered, then roared to life. Light flooded the room, then swept outward across the water. For the first time in a decade, the lighthouse was awake.

Chapter 2: The Visitor

The next morning, Mara found a man sitting on the rocks below the lighthouse. He wore a soaked fisherman's coat and stared at the sea with distant eyes. She called down to him, but he did not respond.

She climbed down to him. Up close, she could see that his lips were blue and his hands were shaking. He had been in the water a long time.

You need to come inside, she said. He looked up at her, and for a moment, his eyes focused. He spoke a single word: Remember.

Mara helped him to his feet and guided him up the path to the lighthouse. She made a fire, wrapped him in blankets, and set water to boil. He sat in the old armchair, watching the flames, and said nothing more.

She did not know it yet, but the man had brought something with him from the sea. Something that would change everything she thought she knew about the island, about her grandfather, and about herself.`;

export async function seed(): Promise<void> {
  const env = getEnv();
  console.log('[seed] creating demo project...');

  const { createDb, createRepository } = await import('@audiocomic/db');
  const db = createDb(env.DATABASE_URL);
  const repo = createRepository(db) as unknown as {
    projects: {
      create(p: Project): Promise<void>;
      list(): Promise<Project[]>;
    };
    assets: {
      create(a: {
        id: string;
        projectId: string;
        modality: 'text';
        filename: string;
        mimeType: string;
        sizeBytes: number;
        storageKey: string;
        uploadedAt: string;
      }): Promise<void>;
    };
    jobs: {
      create(j: JobRecord): Promise<void>;
    };
  };

  const projectId = uuid();
  const now = nowIso();
  const storageKey = `projects/${projectId}/source/book.txt`;

  // Write the sample text to storage
  const assetPath = join(env.UPLOAD_DIR, storageKey);
  await fs.mkdir(dirname(assetPath), { recursive: true });
  await fs.writeFile(assetPath, SAMPLE_TEXT, 'utf-8');

  // Create the source asset
  await repo.assets.create({
    id: uuid(),
    projectId,
    modality: 'text',
    filename: 'book.txt',
    mimeType: 'text/plain',
    sizeBytes: Buffer.byteLength(SAMPLE_TEXT),
    storageKey,
    uploadedAt: now,
  });

  // Create the project
  const project: Project = {
    id: projectId,
    name: 'The Lighthouse Keeper',
    description: 'A demo project — a short story about a woman returning to her grandfather's lighthouse.',
    status: 'created',
    modality: 'text',
    createdAt: now,
    updatedAt: now,
    providerSettings: {},
    stages: [],
  };
  await repo.projects.create(project);

  // Enqueue the full pipeline job
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

  console.log(`[seed] demo project created: ${projectId}`);
  console.log(`[seed] job enqueued: ${job.id}`);
  console.log(`[seed] start the worker with: bun run worker`);
  console.log(`[seed] view the project at: http://localhost:${env.WEB_PORT}/projects/${projectId}`);
}

seed().catch((err) => {
  console.error('[seed] error:', err);
  process.exit(1);
});
