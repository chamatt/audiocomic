// Adapter interfaces and shared option/result types
export * from "./types";

// Transcription
export { OpenAITranscriptionAdapter, createTranscriptionAdapter } from "./transcription";

// Story planner
export { AIStoryPlanner, createStoryPlanner } from "./planner";

// TTS
export { OpenAITTSAdapter, createTTSAdapter } from "./tts";

// Image generation
export { AISDKImageAdapter, createImageAdapter } from "./image";

// Prompt composer + section memory builder (pure functions)
export { composePanelPrompt, composeNegativePrompt, buildSectionMemory, buildCharacterNameIndex, resolveCharactersFromText, backfillBeatCharacters } from "./prompt";

// Description cleanup (LLM-powered)
export { cleanupDescription, mergeDescriptions } from "./cleanup";
export { resolveLanguageModel } from "./planner";

// LLM-powered panel prompt optimization
export { optimizePanelPrompt } from "./optimize-prompt";
export type { OptimizePanelPromptInput, OptimizePanelPromptResult } from "./optimize-prompt";
