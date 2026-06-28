// Embedding providers for the knowledge base.
//
// The package ships an OpenAI provider (text-embedding-3-small, 1536 dims,
// matching the `vector(1536)` column on `knowledge_embeddings`) and a Groq
// stub that fails loudly — Groq does not currently expose a public embeddings
// endpoint, so the factory falls back to OpenAI. The factory selects a
// provider from the shared env config.

import type { Env } from '@audiocomic/shared';
import type { EmbeddingProvider } from './types';

/** Default OpenAI embedding model — 1536 dimensions. */
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
/** OpenAI caps batched embedding requests at 100 inputs. */
const OPENAI_MAX_BATCH = 100;
/** Expected vector dimensionality — must match the DB column. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Embedding provider backed by the OpenAI embeddings API.
 *
 * Uses the global `fetch` (Node 18+ / Bun) — no SDK dependency. `embedMany`
 * splits inputs into batches of 100 to respect the API limit and preserves
 * input order in the output.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(
    apiKey: string,
    options?: { model?: string; endpoint?: string },
  ) {
    if (!apiKey) {
      throw new Error('OpenAIEmbeddingProvider requires an API key');
    }
    this.apiKey = apiKey;
    this.model = options?.model ?? OPENAI_EMBEDDING_MODEL;
    this.endpoint = options?.endpoint ?? 'https://api.openai.com/v1/embeddings';
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedMany([text]);
    if (!vec) {
      throw new Error('OpenAIEmbeddingProvider.embed: provider returned no vector');
    }
    return vec;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += OPENAI_MAX_BATCH) {
      const batch = texts.slice(i, i + OPENAI_MAX_BATCH);
      const vectors = await this.embedBatch(batch);
      for (const v of vectors) {
        if (v.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `OpenAI returned ${v.length}-dim embedding, expected ${EMBEDDING_DIMENSIONS} (model=${this.model})`,
          );
        }
        out.push(v);
      }
    }
    return out;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: batch }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `OpenAI embeddings request failed (${res.status} ${res.statusText}): ${body}`,
      );
    }

    const json = (await res.json()) as {
      data: { embedding: number[] }[];
    };

    // OpenAI returns embeddings in input order, but sort by index defensively.
    // The API does not include an `index` field on the embeddings endpoint for
    // all model variants, so we rely on documented input-order guarantee.
    return json.data.map((d) => d.embedding);
  }
}

/**
 * Groq does not currently expose a public embeddings endpoint. This provider
 * exists so callers can attempt it explicitly; it always throws so the
 * factory can fall back to OpenAI without a silent no-op.
 */
export class GroqEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('GroqEmbeddingProvider requires an API key');
    }
    this.apiKey = apiKey;
  }

  async embed(_text: string): Promise<number[]> {
    throw new Error(
      'Groq does not expose a public embeddings endpoint. Configure OPENAI_API_KEY to use OpenAI embeddings instead.',
    );
  }

  async embedMany(_texts: string[]): Promise<number[][]> {
    throw new Error(
      'Groq does not expose a public embeddings endpoint. Configure OPENAI_API_KEY to use OpenAI embeddings instead.',
    );
  }
}

/**
 * Select an embedding provider from the environment.
 *
 * Today only OpenAI is supported (Groq has no embeddings API). Throws a clear
 * error when no provider can be constructed so callers can surface guidance.
 */
export function createEmbeddingProvider(env: Env): EmbeddingProvider {
  if (env.OPENAI_API_KEY) {
    return new OpenAIEmbeddingProvider(env.OPENAI_API_KEY);
  }
  throw new Error(
    'No embedding provider available. Set OPENAI_API_KEY to enable knowledge-base embeddings.',
  );
}
