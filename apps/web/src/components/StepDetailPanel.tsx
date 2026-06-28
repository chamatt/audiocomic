'use client';

import { useState, useEffect } from 'react';
import type { StepState } from '@audiocomic/actors';

interface StepDetailPanelProps {
  step: StepState | null;
  pipelineKey: string;
  onClose: () => void;
  onRunStep: (stepId: string) => void;
  onRetryStep: (stepId: string) => void;
  onSkipStep: (stepId: string) => void;
  onInvalidateStep: (stepId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#6c757d',
  running: '#0d6efd',
  paused: '#ffc107',
  completed: '#198754',
  failed: '#dc3545',
  skipped: '#6c757d',
  stale: '#fd7e14',
};

export function StepDetailPanel({
  step,
  pipelineKey,
  onClose,
  onRunStep,
  onRetryStep,
  onSkipStep,
  onInvalidateStep,
}: StepDetailPanelProps) {
  const [result, setResult] = useState<unknown>(null);
  const [logs, setLogs] = useState<unknown[]>([]);
  const [activeTab, setActiveTab] = useState<'details' | 'result' | 'logs'>('details');

  useEffect(() => {
    if (step === null) return;
    setResult(null);
    setLogs([]);
    setActiveTab('details');
  }, [step?.definition.id]);

  if (step === null) return null;

  const color = STATUS_COLORS[step.status] ?? '#6c757d';
  const duration = step.completedAt !== undefined && step.startedAt !== undefined
    ? `${((step.completedAt - step.startedAt) / 1000).toFixed(1)}s`
    : null;

  const outputResult = step.result as { data?: unknown; summary?: string; inputHash?: string } | unknown;
  const isStepOutput = typeof outputResult === 'object' && outputResult !== null && 'data' in outputResult && 'inputHash' in outputResult;

  async function loadResult() {
    if (step === null) return;
    try {
      const res = await fetch(`/api/pipeline/${pipelineKey}/step/${step.definition.id}/result`);
      const json = await res.json();
      if (json.ok) setResult(json.data);
    } catch {}
  }

  async function loadLogs() {
    if (step === null) return;
    try {
      const res = await fetch(`/api/pipeline/${pipelineKey}/step/${step.definition.id}/logs`);
      const json = await res.json();
      if (json.ok) setLogs(json.data as unknown[]);
    } catch {}
  }

  useEffect(() => {
    if (activeTab === 'result' && result === null) loadResult();
    if (activeTab === 'logs' && logs.length === 0) loadLogs();
  }, [activeTab]);

  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: 0,
      bottom: 0,
      width: '420px',
      background: '#0f0f23',
      borderLeft: '1px solid #2a2a4a',
      padding: '20px',
      overflowY: 'auto',
      zIndex: 1000,
      color: '#e0e0e0',
      fontFamily: 'monospace',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', color }}>
            {step.definition.name}
          </h3>
          <div style={{ fontSize: '12px', color: '#888' }}>
            {step.definition.id} · {step.definition.type}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '20px',
          }}
        >
          ×
        </button>
      </div>

      {/* Status badge */}
      <div style={{
        display: 'inline-block',
        padding: '4px 12px',
        borderRadius: '4px',
        background: `${color}22`,
        color,
        fontSize: '12px',
        fontWeight: 'bold',
        marginBottom: '12px',
      }}>
        {step.status.toUpperCase()}
        {duration !== null && ` · ${duration}`}
        {step.attempts > 1 && ` · attempt ${step.attempts}`}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <ActionButton label="Run" color="#0d6efd" onClick={() => onRunStep(step.definition.id)} />
        <ActionButton label="Retry" color="#ffc107" onClick={() => onRetryStep(step.definition.id)} />
        <ActionButton label="Skip" color="#6c757d" onClick={() => onSkipStep(step.definition.id)} />
        <ActionButton label="Invalidate" color="#fd7e14" onClick={() => onInvalidateStep(step.definition.id)} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', borderBottom: '1px solid #2a2a4a' }}>
        <TabButton active={activeTab === 'details'} onClick={() => setActiveTab('details')}>Details</TabButton>
        <TabButton active={activeTab === 'result'} onClick={() => setActiveTab('result')}>Result</TabButton>
        <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')}>Logs</TabButton>
      </div>

      {/* Tab content */}
      {activeTab === 'details' && (
        <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
          {step.summary !== undefined && (
            <div style={{ marginBottom: '8px' }}>
              <span style={{ color: '#888' }}>Summary: </span>
              {step.summary}
            </div>
          )}
          {step.inputHash !== undefined && (
            <div style={{ marginBottom: '8px' }}>
              <span style={{ color: '#888' }}>InputHash: </span>
              <code style={{ fontSize: '11px' }}>{step.inputHash}</code>
            </div>
          )}
          {step.error !== undefined && (
            <div style={{
              padding: '8px',
              background: '#dc354522',
              borderRadius: '4px',
              color: '#ff6b6b',
              fontSize: '12px',
              marginBottom: '8px',
            }}>
              {step.error}
            </div>
          )}
          <div style={{ marginTop: '12px' }}>
            <span style={{ color: '#888' }}>Config: </span>
            <pre style={{ fontSize: '11px', overflowX: 'auto' }}>
              {JSON.stringify(step.definition.config, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {activeTab === 'result' && (
        <div>
          {result !== null ? (
            <pre style={{
              fontSize: '11px',
              overflow: 'auto',
              background: '#1a1a2e',
              padding: '12px',
              borderRadius: '4px',
              color: '#a0e0a0',
            }}>
              {JSON.stringify(
                isStepOutput ? (outputResult as { data: unknown }).data : result,
                null,
                2,
              )}
            </pre>
          ) : (
            <div style={{ color: '#888', fontSize: '13px' }}>Loading result...</div>
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div style={{ fontSize: '11px', lineHeight: '1.8' }}>
          {logs.length > 0 ? (
            logs.map((event, i) => {
              const e = event as { type?: string; label?: string; detail?: string; elapsed?: number; chunkIndex?: number; timestamp?: number };
              const time = e.timestamp !== undefined
                ? new Date(e.timestamp).toISOString().slice(11, 19)
                : '?';
              return (
                <div key={i} style={{ borderBottom: '1px solid #1a1a2e', padding: '4px 0' }}>
                  <span style={{ color: '#666' }}>[{time}]</span>{' '}
                  <span style={{ color: '#0dcaf0' }}>{e.type}</span>{' '}
                  <span>{e.label}</span>
                  {e.elapsed !== undefined && <span style={{ color: '#888' }}> {e.elapsed}s</span>}
                  {e.chunkIndex !== undefined && <span style={{ color: '#888' }}> #{e.chunkIndex}</span>}
                  {e.detail !== undefined && <div style={{ color: '#aaa', paddingLeft: '60px' }}>{e.detail}</div>}
                </div>
              );
            })
          ) : (
            <div style={{ color: '#888' }}>No logs available.</div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px',
        background: `${color}22`,
        border: `1px solid ${color}44`,
        color,
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '12px',
      }}
    >
      {label}
    </button>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        background: active ? '#2a2a4a' : 'transparent',
        border: 'none',
        color: active ? '#e0e0e0' : '#888',
        cursor: 'pointer',
        fontSize: '12px',
        borderBottom: active ? '2px solid #0d6efd' : 'none',
      }}
    >
      {children}
    </button>
  );
}
