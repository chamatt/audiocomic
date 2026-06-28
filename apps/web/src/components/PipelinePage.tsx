'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Nav } from '@/components/Nav';
import { PipelineFlow } from '@/components/PipelineFlow';
import { StepDetailPanel } from '@/components/StepDetailPanel';
import {
  getPipelineStatusActor,
  startPipelineActor,
  pausePipelineActor,
  resumePipelineActor,
  retryStepActor,
  skipStepActor,
  runStepActor,
  invalidateStepActor,
} from '@/lib/actor-actions';
import type { PipelineState, StepState } from '@audiocomic/actors';

interface PipelinePageProps {
  pipelineKey: string;
}

/** Step-level events that should trigger a status refresh. */
const STEP_EVENTS = new Set([
  'stepStarted',
  'stepCompleted',
  'stepFailed',
  'pipelineStarted',
  'pipelineCompleted',
  'pipelinePaused',
  'pipelineResumed',
]);

export function PipelinePage({ pipelineKey }: PipelinePageProps) {
  const [state, setState] = useState<PipelineState | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<Record<string, unknown[]>>({});
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch full status from the actor (authoritative source)
  const refresh = useCallback(async () => {
    const result = await getPipelineStatusActor(pipelineKey);
    if (result.ok) {
      setState(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [pipelineKey]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // SSE subscription for real-time events
  useEffect(() => {
    const es = new EventSource(`/api/pipeline/${pipelineKey}/events`);
    eventSourceRef.current = es;

    // On connection, do a full refresh
    es.addEventListener('connected', () => {
      refresh();
    });

    es.addEventListener('error', (e) => {
      // EventSource auto-reconnects; only show error if it stays closed
      if (es.readyState === EventSource.CLOSED) {
        setError('Lost connection to pipeline events');
      }
    });

    // Step-level events → refresh full state (cheap, non-blocking)
    for (const eventName of STEP_EVENTS) {
      es.addEventListener(eventName, () => {
        refresh();
      });
    }

    // stepProgress events → accumulate in live buffer (no full refresh needed)
    es.addEventListener('stepProgress', (e) => {
      try {
        const data = JSON.parse(e.data) as { stepId?: string; type?: string; label?: string; detail?: string };
        const stepId = data.stepId;
        if (stepId !== undefined) {
          setLiveEvents((prev) => {
            const existing = prev[stepId] ?? [];
            const next = [...existing, data];
            // Ring buffer: keep last 50 progress events per step
            return { ...prev, [stepId]: next.slice(-50) };
          });
        }
      } catch {
        // ignore parse errors
      }
    });

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [pipelineKey, refresh]);

  // Merge live events into step state for display
  const stepsWithLive: StepState[] | undefined = state?.steps.map((step) => {
    const events = liveEvents[step.definition.id];
    if (events === undefined || events.length === 0) return step;
    return {
      ...step,
      progressEvents: [...(step.progressEvents ?? []), ...events],
    };
  });

  const liveState: PipelineState | null = stepsWithLive !== undefined && state !== null
    ? { ...state, steps: stepsWithLive }
    : state;

  const selectedStep = liveState?.steps.find((s) => s.definition.id === selectedStepId) ?? null;

  const handleRunAll = useCallback(async () => {
    await startPipelineActor(pipelineKey);
    refresh();
  }, [pipelineKey, refresh]);

  const handlePause = useCallback(async () => {
    await pausePipelineActor(pipelineKey);
    refresh();
  }, [pipelineKey, refresh]);

  const handleResume = useCallback(async () => {
    await resumePipelineActor(pipelineKey);
    refresh();
  }, [pipelineKey, refresh]);

  const handleRunStep = useCallback(async (stepId: string) => {
    await runStepActor(pipelineKey, stepId);
    refresh();
  }, [pipelineKey, refresh]);

  const handleRetryStep = useCallback(async (stepId: string) => {
    await retryStepActor(pipelineKey, stepId);
    refresh();
  }, [pipelineKey, refresh]);

  const handleSkipStep = useCallback(async (stepId: string) => {
    await skipStepActor(pipelineKey, stepId);
    refresh();
  }, [pipelineKey, refresh]);

  const handleInvalidateStep = useCallback(async (stepId: string) => {
    await invalidateStepActor(pipelineKey, stepId);
    refresh();
  }, [pipelineKey, refresh]);

  return (
    <div>
      <Nav />
      <div style={{ padding: '20px' }}>
        <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>
          Pipeline: {pipelineKey}
        </h1>
        {error !== null && (
          <div style={{
            padding: '12px',
            background: '#dc354522',
            color: '#ff6b6b',
            borderRadius: '4px',
            marginBottom: '16px',
            fontFamily: 'monospace',
            fontSize: '13px',
          }}>
            Error: {error}
          </div>
        )}
        <div style={{
          height: '70vh',
          background: '#1a1a2e',
          borderRadius: '8px',
          border: '1px solid #2a2a4a',
          overflow: 'hidden',
        }}>
          <PipelineFlow
            pipelineKey={pipelineKey}
            state={liveState}
            onRunStep={handleRunStep}
            onRetryStep={handleRetryStep}
            onSkipStep={handleSkipStep}
            onInvalidateStep={handleInvalidateStep}
            onRunAll={handleRunAll}
            onPause={handlePause}
            onResume={handleResume}
            onSelectStep={setSelectedStepId}
            selectedStepId={selectedStepId}
          />
        </div>
      </div>
      <StepDetailPanel
        step={selectedStep}
        pipelineKey={pipelineKey}
        onClose={() => setSelectedStepId(null)}
        onRunStep={handleRunStep}
        onRetryStep={handleRetryStep}
        onSkipStep={handleSkipStep}
        onInvalidateStep={handleInvalidateStep}
      />
    </div>
  );
}
