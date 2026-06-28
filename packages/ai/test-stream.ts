import { config } from 'dotenv';
config({ path: '../../.env' });

import { createStoryPlanner } from './src/planner.ts';
import { getEnv, resetEnv } from '@audiocomic/shared';

resetEnv();
const env = getEnv();
console.log('Model:', env.DEFAULT_LLM_MODEL);

const planner = createStoryPlanner('openrouter', env.DEFAULT_LLM_MODEL, env);

const emit = (e: any) => {
	console.log(`[emit] ${e.type} label=${e.label} ${e.chunkIndex ? `tok=${e.chunkIndex}` : ''} ${e.elapsed ? `${e.elapsed}s` : ''} ${e.detail || ''}`);
};

console.log('\nStarting planStory...\n');
const start = Date.now();
const result = await planner.planStory({
	projectId: 'test-stream',
	text: 'This is Audible.',
	emit,
});
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\nDone in ${elapsed}s`);
console.log(`  sections: ${result.sections.length}`);
console.log(`  characters: ${result.characters.length}`);
console.log(`  panelHints: ${result.panelHints?.length ?? 0}`);
