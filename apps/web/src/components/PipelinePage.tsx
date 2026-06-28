'use client';

import { useState, useEffect, useCallback } from 'react';
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
import type { PipelineState } from '@audiocomic/actors';

interface PipelinePageProps {
  pipelineKey: string;
}

export function PipelinePage({ pipelineKey }: PipelinePageProps) {
  const [state, setState] = useState<PipelineState | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll for status updates
  const refresh = useCallback(async () => {
    const result = await getPipelineStatusActor(pipelineKey);
    if (result.ok) {
      setState(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [pipelineKey]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  const selectedStep = state?.steps.find((s) => s.definition.id === selectedStepId) ?? null;

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
            state={state}
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
