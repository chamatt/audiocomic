// Mastra agents for story planning and bible building.
// These agents use tool calling to retrieve knowledge from the RAG index
// and character bible, enabling cross-chapter consistency.

import { Agent } from '@mastra/core/agent';
import { createProjectTools, type ToolContext } from './tools.ts';

/**
 * Create a story planner agent for a specific project.
 * The agent uses tool calls to retrieve character states, world context,
 * and cross-chapter information before planning the comic adaptation.
 */
export function createStoryPlannerAgent(ctx: ToolContext): Agent {
  const tools = createProjectTools(ctx);

  return new Agent({
    id: `story-planner-${ctx.projectId}`,
    name: 'Story Planner',
    instructions: `You are a story planner for an audiobook-to-comic system.

When planning a chapter:
1. Use character-lookup to get each character's current state and appearance
2. Use character-timeline to check for outfit/state changes across chapters
3. Use world-lookup to get the world setting, rules, and art style
4. Use vector-query to find relevant events from other chapters
5. Plan the story with consistency: characters should look and act the same
   as in previous chapters unless there's a narrative reason for change

Output: structured JSON with world, characters, scenes, beats, panels.
The JSON should match this structure:
{
  "world": { "setting": string, "genre": string[], "tone": string, "artStyle": string },
  "characters": [{ "name": string, "description": string, "role": string, "aliases": string[] }],
  "sections": [{ "level": "chapter"|"scene"|"beat", "title": string, "summary": string, "charactersPresent": string[], "emotionalTone": string }],
  "characterStates": [{ "characterName": string, "outfit": string, "location": string, "mood": string }]
}`,
    model: 'openrouter/mistralai/mistral-nemo',
    tools,
  });
}

/**
 * Create a bible builder agent for a specific project.
 * The agent extracts characters, locations, and events from chapter
 * transcriptions and maintains the story bible with temporal tracking.
 */
export function createBibleBuilderAgent(ctx: ToolContext): Agent {
  const tools = createProjectTools(ctx);

  return new Agent({
    id: `bible-builder-${ctx.projectId}`,
    name: 'Bible Builder',
    instructions: `You build and maintain the story bible from chapter transcriptions.

When processing a new chapter:
1. Extract characters, locations, objects, events from the text
2. Use character-lookup to check if characters already exist in the bible
3. Use character-timeline to track state changes (outfit, location, mood)
4. Use world-lookup to check existing world information
5. Use vector-query to find related context from other chapters
6. Flag contradictions with previous chapters

Output: structured JSON with knowledge updates:
{
  "characters": [{ "name": string, "description": string, "role": string, "isNew": boolean }],
  "characterStates": [{ "characterName": string, "outfit": string, "location": string, "mood": string, "notes": string }],
  "worldUpdates": { "setting": string, "newRules": string[] },
  "wikiPages": [{ "type": "character"|"location"|"object"|"concept"|"event", "title": string, "content": string }],
  "contradictions": [{ "description": string, "existingInfo": string, "newInfo": string }]
}`,
    model: 'openrouter/mistralai/mistral-nemo',
    tools,
  });
}
