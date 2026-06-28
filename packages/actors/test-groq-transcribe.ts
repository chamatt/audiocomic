import { createOpenAI } from "@ai-sdk/openai";
import { experimental_transcribe as transcribe } from "ai";
import { readFileSync } from "node:fs";

const groqProvider = createOpenAI({
  apiKey: "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",
  baseURL: "https://api.groq.com/openai/v1",
  compatibility: "compatible",
});

const model = groqProvider.transcription("whisper-large-v3-turbo");
const audio = readFileSync("/Users/matheus/code/audiocomic/test-fixtures/chapter-001.m4b");

try {
  const result = await transcribe({
    model,
    audio,
    maxRetries: 1,
  });
  console.log("SUCCESS");
  console.log("text:", result.text?.slice(0, 300));
  console.log("duration:", result.durationInSeconds);
  console.log("language:", result.language);
} catch (e: any) {
  console.log("ERROR:", e?.message ?? String(e));
  if (e?.cause) console.log("cause:", e.cause);
  if (e?.responseBody) console.log("body:", e.responseBody);
}
