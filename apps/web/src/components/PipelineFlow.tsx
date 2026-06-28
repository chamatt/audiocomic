'use client';

import { useCallback, useMemo, useState, memo, type CSSProperties, type MouseEvent } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { PipelineState, StepState } from '@audiocomic/actors';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PipelineFlowProps {
  pipelineKey: string;
  state: PipelineState | null;
  onRunStep: (stepId: string) => void;
  onRetryStep: (stepId: string) => void;
  onSkipStep: (stepId: string) => void;
  onInvalidateStep: (stepId: string) => void;
  onRunAll: () => void;
  onPause: () => void;
  onResume: () => void;
  onSelectStep: (stepId: string | null) => void;
  selectedStepId: string | null;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const THEME = {
  bg: '#1a1a2e',
  node: '#16213e',
  nodeBorder: '#2a2a4a',
  nodeSelected: '#f97316',
  text: '#e0e0e0',
  textDim: '#8a8aa8',
  textMuted: '#5a5a78',
  accent: '#f97316',
  headerBar: '#0f0f23',
} as const;

const STATUS_COLORS: Record<StepState['status'], string> = {
  pending: '#6b7280',
  running: '#3b82f6',
  paused: '#a78bfa',
  completed: '#22c55e',
  failed: '#ef4444',
  skipped: '#6b7280',
  stale: '#f97316',
};

const PIPELINE_STATUS_COLORS: Record<PipelineState['status'], string> = {
  idle: '#6b7280',
  running: '#3b82f6',
  paused: '#a78bfa',
  completed: '#22c55e',
  failed: '#ef4444',
  scheduled: '#60a5fa',
};

// ---------------------------------------------------------------------------
// Hard-coded DAG layout (columns described in the spec)
// ---------------------------------------------------------------------------

const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  normalize: { x: 0, y: 220 },
  transcribe: { x: 260, y: 220 },
  segment: { x: 520, y: 220 },
  plan_story: { x: 780, y: 220 },
  // Col 4: three parallel branches
  build_bibles: { x: 1040, y: 60 },
  section_memory: { x: 1040, y: 220 },
  plan_pages: { x: 1040, y: 380 },
  // Col 5: plan_pages outputs
  validate_layout: { x: 1300, y: 140 },
  compose_prompts: { x: 1300, y: 300 },
  // Col 6
  render_panels: { x: 1560, y: 220 },
  // Col 7
  panel_qa: { x: 1820, y: 140 },
  compose_pages: { x: 1820, y: 300 },
  // Col 8
  lettering: { x: 2080, y: 140 },
  export_static: { x: 2080, y: 300 },
  // Col 9
  export_motion: { x: 2340, y: 220 },
};

const DEFAULT_POSITION = { x: 2600, y: 220 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(step: StepState): string | null {
  if (step.status !== 'completed' || step.startedAt == null || step.completedAt == null) {
    return null;
  }
  const seconds = (step.completedAt - step.startedAt) / 1000;
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}


// ---------------------------------------------------------------------------
// Node data shape
// ---------------------------------------------------------------------------

interface PipelineNodeData {
  step: StepState;
  selected: boolean;
  onOpenMenu: (stepId: string, e: MouseEvent<HTMLElement>) => void;
}

type PipelineNode = Node<PipelineNodeData, 'pipeline'>;

// ---------------------------------------------------------------------------
// Custom node
// ---------------------------------------------------------------------------

const PipelineStepNode = memo(function PipelineStepNode({ data }: NodeProps<PipelineNode>) {
  const { step, selected, onOpenMenu } = data;
  const status = step.status;
  const color = STATUS_COLORS[status];
  const duration = formatDuration(step);
  const isRunning = status === 'running';
  const isSkipped = status === 'skipped';
  const isFailed = status === 'failed';

  const nodeStyle: CSSProperties = {
    background: THEME.node,
    border: `1.5px solid ${selected ? THEME.nodeSelected : THEME.nodeBorder}`,
    borderRadius: 10,
    padding: 0,
    width: 220,
    color: THEME.text,
    fontSize: 12,
    boxShadow: selected
      ? `0 0 0 2px ${THEME.nodeSelected}55, 0 6px 18px rgba(0,0,0,0.45)`
      : '0 4px 12px rgba(0,0,0,0.35)',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };

  return (
    <div style={nodeStyle}>
      {/* Connection handles — top for inputs, bottom for outputs */}
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />

      {/* Header row: status dot + name + context menu trigger */}
      <div style={headerStyle}>
        <span
          className={isRunning ? 'pf-pulse' : undefined}
          style={{
            ...statusDotStyle,
            background: color,
            boxShadow: isRunning ? `0 0 8px ${color}` : 'none',
          }}
          aria-label={`status: ${status}`}
        />
        <span
          style={{
            ...nameStyle,
            textDecoration: isSkipped ? 'line-through' : 'none',
            color: isSkipped ? THEME.textMuted : THEME.text,
          }}
          title={step.definition.name}
        >
          {step.definition.name}
        </span>
        <button
          type="button"
          style={menuButtonStyle}
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu(step.definition.id, e);
          }}
          aria-label="Step actions"
          title="Actions"
        >
          ⋮
        </button>
      </div>

      {/* Body: meta lines */}
      <div style={bodyStyle}>
        <div style={metaRowStyle}>
          <span style={{ color, textTransform: 'capitalize', fontWeight: 500 }}>{status}</span>
          {step.attempts > 0 && (
            <span style={attemptsStyle}>attempt {step.attempts}</span>
          )}
          {duration && <span style={durationStyle}>{duration}</span>}
        </div>

        {step.summary && (
          <div style={summaryStyle} title={step.summary}>
            {step.summary}
          </div>
        )}

        {isFailed && step.error && (
          <div style={errorStyle} title={step.error}>
            {step.error}
          </div>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Inline style objects (kept outside the component for referential stability)
// ---------------------------------------------------------------------------

const handleStyle: CSSProperties = {
  width: 8,
  height: 8,
  background: THEME.nodeBorder,
  border: `2px solid ${THEME.bg}`,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderBottom: `1px solid ${THEME.nodeBorder}`,
};

const statusDotStyle: CSSProperties = {
  display: 'inline-block',
  width: 10,
  height: 10,
  borderRadius: '50%',
  flexShrink: 0,
};

const nameStyle: CSSProperties = {
  flex: 1,
  fontWeight: 600,
  fontSize: 13,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const menuButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: THEME.textDim,
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: '0 4px',
  borderRadius: 4,
};

const bodyStyle: CSSProperties = {
  padding: '8px 10px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const metaRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
};


const attemptsStyle: CSSProperties = {
  color: THEME.textMuted,
};

const durationStyle: CSSProperties = {
  color: THEME.textDim,
  marginLeft: 'auto',
  fontVariantNumeric: 'tabular-nums',
};

const summaryStyle: CSSProperties = {
  color: THEME.textDim,
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const errorStyle: CSSProperties = {
  color: '#fca5a5',
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

// ---------------------------------------------------------------------------
// Context menu (per-node dropdown)
// ---------------------------------------------------------------------------

interface MenuState {
  stepId: string;
  x: number;
  y: number;
}

type MenuAction = 'onRunStep' | 'onRetryStep' | 'onSkipStep' | 'onInvalidateStep';
const MENU_ITEMS: { label: string; action: MenuAction; icon: string }[] = [
  { label: 'Run', action: 'onRunStep', icon: '▶' },
  { label: 'Retry', action: 'onRetryStep', icon: '↻' },
  { label: 'Skip', action: 'onSkipStep', icon: '⏭' },
  { label: 'Invalidate', action: 'onInvalidateStep', icon: '⊘' },
];

function ContextMenu({
  menu,
  onClose,
  handlers,
}: {
  menu: MenuState;
  onClose: () => void;
  handlers: {
    onRunStep: (id: string) => void;
    onRetryStep: (id: string) => void;
    onSkipStep: (id: string) => void;
    onInvalidateStep: (id: string) => void;
  };
}) {
  const menuStyle: CSSProperties = {
    position: 'fixed',
    top: menu.y,
    left: menu.x,
    background: THEME.node,
    border: `1px solid ${THEME.nodeBorder}`,
    borderRadius: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    padding: 4,
    zIndex: 50,
    minWidth: 140,
  };

  return (
    <>
      {/* Click-away catcher */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
        aria-hidden
      />
      <div style={menuStyle} onClick={(e) => e.stopPropagation()}>
        {MENU_ITEMS.map((item) => {
          const handler = handlers[item.action];
          return (
            <button
              key={item.label}
              type="button"
              style={menuItemStyle}
              onClick={(e) => {
                e.stopPropagation();
                handler(menu.stepId);
                onClose();
              }}
            >
              <span style={{ width: 16, textAlign: 'center', color: THEME.textDim }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

const menuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '7px 10px',
  background: 'transparent',
  border: 'none',
  color: THEME.text,
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 6,
};

// ---------------------------------------------------------------------------
// Controls bar
// ---------------------------------------------------------------------------

function ControlsBar({
  status,
  onRunAll,
  onPause,
  onResume,
}: {
  status: PipelineState['status'];
  onRunAll: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const isRunning = status === 'running';
  const isPaused = status === 'paused';

  const barStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px',
    background: THEME.headerBar,
    borderBottom: `1px solid ${THEME.nodeBorder}`,
    zIndex: 10,
    position: 'relative',
  };

  return (
    <div style={barStyle}>
      <span style={{ fontWeight: 700, fontSize: 14, color: THEME.text }}>Pipeline</span>
      <span
        style={{
          ...statusBadgeStyle,
          color: PIPELINE_STATUS_COLORS[status],
          border: `1px solid ${PIPELINE_STATUS_COLORS[status]}55`,
        }}
      >
        {status}
      </span>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        style={btnStyle(isRunning, THEME.accent)}
        onClick={onRunAll}
        disabled={isRunning}
        title="Run all steps"
      >
        Run All
      </button>
      <button
        type="button"
        style={btnStyle(!isRunning, '#eab308')}
        onClick={onPause}
        disabled={!isRunning}
        title="Pause pipeline"
      >
        Pause
      </button>
      <button
        type="button"
        style={btnStyle(!isPaused, '#22c55e')}
        onClick={onResume}
        disabled={!isPaused}
        title="Resume pipeline"
      >
        Resume
      </button>
    </div>
  );
}

const statusBadgeStyle: CSSProperties = {
  fontSize: 11,
  textTransform: 'capitalize',
  padding: '2px 10px',
  borderRadius: 12,
  background: THEME.node,
  fontWeight: 500,
};

function btnStyle(active: boolean, accent: string): CSSProperties {
  return {
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    border: `1px solid ${active ? accent : THEME.nodeBorder}`,
    background: active ? `${accent}22` : THEME.node,
    color: active ? accent : THEME.textDim,
    cursor: active ? 'pointer' : 'not-allowed',
    opacity: active ? 1 : 0.6,
    transition: 'background 0.15s, border-color 0.15s',
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PipelineFlow({
  pipelineKey,
  state,
  onRunStep,
  onRetryStep,
  onSkipStep,
  onInvalidateStep,
  onRunAll,
  onPause,
  onResume,
  onSelectStep,
  selectedStepId,
}: PipelineFlowProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = useCallback((stepId: string, e: MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({ stepId, x: rect.right - 150, y: rect.bottom + 4 });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);


  // --- Build nodes ---------------------------------------------------------
  const nodes: PipelineNode[] = useMemo(() => {
    const steps = state?.steps ?? [];
    return steps.map((step) => {
      const pos = NODE_POSITIONS[step.definition.id] ?? DEFAULT_POSITION;
      return {
        id: step.definition.id,
        type: 'pipeline',
        position: pos,
        data: {
          step,
          selected: selectedStepId === step.definition.id,
          onOpenMenu: openMenu,
        },
        // Don't let React Flow drag nodes around — layout is fixed.
        draggable: false,
        selectable: false,
      };
    });
  }, [state, selectedStepId, openMenu]);

  // --- Build edges from dependsOn -----------------------------------------
  const edges: Edge[] = useMemo(() => {
    const steps = state?.steps ?? [];
    const byId = new Map(steps.map((s) => [s.definition.id, s]));
    const out: Edge[] = [];
    for (const step of steps) {
      for (const dep of step.definition.dependsOn) {
        const source = byId.get(dep);
        const sourceRunning = source?.status === 'running';
        out.push({
          id: `${dep}->${step.definition.id}`,
          source: dep,
          target: step.definition.id,
          type: 'smoothstep',
          animated: sourceRunning,
          style: {
            stroke: sourceRunning ? '#3b82f6' : '#3a3a5a',
            strokeWidth: 1.5,
            strokeDasharray: sourceRunning ? '6 4' : undefined,
          },
        });
      }
    }
    return out;
  }, [state]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => onSelectStep(node.id),
    [onSelectStep],
  );

  const onPaneClick = useCallback(() => {
    onSelectStep(null);
    closeMenu();
  }, [onSelectStep, closeMenu]);

  const nodeTypes = useMemo(() => ({ pipeline: PipelineStepNode }), []);

  const wrapperStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 480,
    background: THEME.bg,
    color: THEME.text,
    borderRadius: 10,
    overflow: 'hidden',
    border: `1px solid ${THEME.nodeBorder}`,
  };

  const flowStyle: CSSProperties = {
    flex: 1,
    background: THEME.bg,
  };

  const pipelineStatus = state?.status ?? 'idle';

  return (
    <div style={wrapperStyle} data-pipeline-key={pipelineKey}>
      <ControlsBar
        status={pipelineStatus}
        onRunAll={onRunAll}
        onPause={onPause}
        onResume={onResume}
      />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.2}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        style={flowStyle}
      >
        <Background variant={BackgroundVariant.Dots} color="#2a2a4a" gap={22} size={1.5} />
        <Controls
          showInteractive={false}
          style={{
            background: THEME.node,
            borderColor: THEME.nodeBorder,
            borderRadius: 8,
          }}
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const step = (n.data as PipelineNodeData | undefined)?.step;
            return step ? STATUS_COLORS[step.status] : THEME.nodeBorder;
          }}
          nodeStrokeColor={THEME.nodeBorder}
          bgColor={THEME.headerBar}
          maskColor="rgba(15,15,35,0.7)"
          style={{ border: `1px solid ${THEME.nodeBorder}` }}
        />
      </ReactFlow>

      {menu && (
        <ContextMenu
          menu={menu}
          onClose={closeMenu}
          handlers={{ onRunStep, onRetryStep, onSkipStep, onInvalidateStep }}
        />
      )}

      {/* Scoped animations: pulse for running nodes, marching dashes for
          animated edges. Injected once per component instance. */}
      <style>{`
        @keyframes pf-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(1.35); }
        }
        .pf-pulse {
          animation: pf-pulse 1.1s ease-in-out infinite;
        }
        .react-flow__edge.animated path {
          stroke-dasharray: 6 4;
          animation: pf-dash 0.7s linear infinite;
        }
        @keyframes pf-dash {
          to { stroke-dashoffset: -10; }
        }
        .react-flow__node {
          cursor: pointer;
        }
        .react-flow__node:hover .pf-pulse {
          filter: brightness(1.15);
        }
        .react-flow__attribution { display: none !important; }
        .react-flow__controls {
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        }
        .react-flow__controls-button {
          background: ${THEME.node};
          color: ${THEME.text};
          border-bottom: 1px solid ${THEME.nodeBorder};
          fill: ${THEME.text};
        }
        .react-flow__controls-button:hover {
          background: ${THEME.nodeBorder};
        }
        .react-flow__controls-button svg {
          fill: ${THEME.text};
          stroke: ${THEME.text};
        }
      `}</style>
    </div>
  );
}

export default PipelineFlow;
