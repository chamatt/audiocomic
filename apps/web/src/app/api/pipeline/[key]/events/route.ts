import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ACTOR_EVENTS = [
  'stepProgress',
  'stepStarted',
  'stepCompleted',
  'stepFailed',
  'pipelineStarted',
  'pipelineCompleted',
  'pipelinePaused',
  'pipelineResumed',
] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const endpoint = process.env.RIVET_ENDPOINT ?? 'http://127.0.0.1:6420';

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cleanup: (() => void) | null = null;

      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // controller already closed
        }
      };

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          // closed
        }
      }, 15_000);

      try {
        // Dynamically import rivetkit/client — it's a transitive dep of @rivetkit/effect
        const { createClient } = await import('rivetkit/client');
        const client = createClient(endpoint) as {
          getOrCreate: (name: string, key: string) => {
            connect: () => {
              ready: Promise<void>;
              on: (event: string, callback: (...args: unknown[]) => void) => () => void;
              dispose: () => Promise<void>;
            };
          };
        };
        const handle = client.getOrCreate('pipeline', key);
        const conn = handle.connect();

        // Wait for connection to be ready
        await conn.ready;

        // Subscribe to all actor events and forward as SSE
        const unsubs = ACTOR_EVENTS.map((eventName) =>
          conn.on(eventName, (...args: unknown[]) => {
            send(eventName, args[0]);
          }),
        );

        cleanup = () => {
          for (const unsub of unsubs) unsub();
          conn.dispose().catch(() => {});
        };

        // Send initial connection confirmation
        send('connected', { pipelineKey: key });
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : 'Connection failed' });
      }

      // Clean up when the client disconnects
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        if (cleanup !== null) cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
