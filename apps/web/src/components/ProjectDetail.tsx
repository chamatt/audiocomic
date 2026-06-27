'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Project, JobRecord, PageSpec, PanelSpec, StorySection, CharacterProfile, WorldBible, ExportBundle } from '@audiocomic/domain';
import { regeneratePanelAction, regeneratePageAction, exportProjectAction } from '@/lib/actions';

export interface ProjectDetailData {
  project: Project;
  job: JobRecord | null;
  pages: (PageSpec & { panels: PanelSpec[]; compositeUrl?: string })[];
  sections: StorySection[];
  characters: CharacterProfile[];
  worldBible: WorldBible | null;
  exports: ExportBundle[];
}

interface Props {
  projectId: string;
  initialProject: Project;
  initialDetail: ProjectDetailData;
}

export function ProjectDetail({ projectId, initialProject, initialDetail }: Props) {
  const [detail, setDetail] = useState<ProjectDetailData>(initialDetail);
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);
  const [polling, setPolling] = useState(false);

  const jobRunning = detail.job?.state === 'running' || detail.job?.state === 'pending';

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/detail`).then((r) => r.json());
    if (res.detail) setDetail(res.detail as ProjectDetailData);
  }, [projectId]);

  useEffect(() => {
    if (!jobRunning) return;
    setPolling(true);
    const interval = setInterval(refresh, 3000);
    return () => {
      clearInterval(interval);
      setPolling(false);
    };
  }, [jobRunning, refresh]);

  const project = detail.project;
  const job = detail.job;
  const progress = job?.progress ?? 0;

  const onRegeneratePanel = async (panelId: string) => {
    await regeneratePanelAction(projectId, panelId);
    refresh();
  };

  const onRegeneratePage = async (pageId: string) => {
    await regeneratePageAction(projectId, pageId);
    refresh();
  };

  const onExport = async (type: 'pages' | 'mp4') => {
    await exportProjectAction(projectId, type);
    refresh();
  };

  const selectedPage = detail.pages[selectedPageIdx];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>{project.name}</h1>
          <p className="text-sm text-dim">{project.description}</p>
        </div>
        <span className={`badge badge-${project.status}`}>{project.status}</span>
      </div>

      {/* Job status */}
      {job && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold">Pipeline Status</h3>
            <span className="text-sm text-dim">
              {job.state} {polling && '• polling...'}
            </span>
          </div>
          <div className="progress-bar mb-4">
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="stage-list">
            {project.stages.map((s) => (
              <div key={s.stage} className={`stage-item ${s.state}`}>
                <span>{s.state === 'completed' ? '✓' : s.state === 'running' ? '⟳' : s.state === 'failed' ? '✗' : '○'}</span>
                <span>{s.stage.replace(/_/g, ' ')}</span>
                {s.error && <span className="text-sm" style={{ color: 'var(--danger)' }}>— {s.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* World & Character Bible */}
      {(detail.worldBible || detail.characters.length > 0) && (
        <div className="grid grid-2">
          {detail.worldBible && (
            <div className="card">
              <h3 className="font-bold mb-2">World Bible</h3>
              <p className="text-sm text-dim mb-2">{detail.worldBible.setting}</p>
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                {detail.worldBible.genre.map((g) => (
                  <span key={g} className="badge badge-created">{g}</span>
                ))}
              </div>
              {detail.worldBible.artStyle && (
                <p className="text-sm mt-2">Art style: {detail.worldBible.artStyle}</p>
              )}
            </div>
          )}
          <div className="card">
            <h3 className="font-bold mb-2">Characters ({detail.characters.length})</h3>
            <div className="flex flex-col gap-2">
              {detail.characters.map((c) => (
                <div key={c.id} className="text-sm">
                  <span className="font-bold">{c.name}</span>
                  <span className="text-dim"> — {c.role}</span>
                  {c.locked && <span className="text-accent"> 🔒</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Story sections */}
      {detail.sections.length > 0 && (
        <div className="card">
          <h3 className="font-bold mb-2">Story Structure ({detail.sections.length} sections)</h3>
          <div className="stage-list">
            {detail.sections.slice(0, 20).map((s) => (
              <div key={s.id} className="stage-item" style={{ paddingLeft: s.level === 'beat' ? 32 : s.level === 'scene' ? 16 : 0 }}>
                <span className="text-dim">[{s.level}]</span>
                <span>{s.title ?? s.summary.slice(0, 60)}</span>
              </div>
            ))}
            {detail.sections.length > 20 && (
              <div className="text-sm text-dim">...and {detail.sections.length - 20} more</div>
            )}
          </div>
        </div>
      )}

      {/* Pages and panels */}
      {detail.pages.length > 0 ? (
        <div className="card">
          <h3 className="font-bold mb-4">Pages ({detail.pages.length})</h3>

          {/* Page selector */}
          <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
            {detail.pages.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setSelectedPageIdx(i)}
                style={i === selectedPageIdx ? { background: 'var(--accent)', color: '#000' } : {}}
              >
                Page {i + 1}
              </button>
            ))}
          </div>

          {/* Selected page */}
          {selectedPage && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold">Page {selectedPageIdx + 1} — {selectedPage.panelCount} panels</h4>
                <button onClick={() => onRegeneratePage(selectedPage.id)} className="text-sm">
                  ⟳ Regenerate Page
                </button>
              </div>

              {selectedPage.compositeUrl ? (
                <div className="page-card mb-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={selectedPage.compositeUrl} alt={`Page ${selectedPageIdx + 1}`} />
                </div>
              ) : (
                <div className="card text-dim text-sm mb-4">Page not yet composed</div>
              )}

              {/* Panel details */}
              <div className="grid grid-2">
                {selectedPage.panels.map((panel) => (
                  <div key={panel.id} className="card">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold">Panel {panel.index + 1}</span>
                      <div className="flex gap-2">
                        <span className={`badge badge-${panel.qaStatus === 'passed' ? 'completed' : panel.qaStatus === 'failed' ? 'failed' : 'created'}`}>
                          {panel.qaStatus}
                        </span>
                        <button
                          onClick={() => onRegeneratePanel(panel.id)}
                          className="text-sm"
                          title="Regenerate this panel only"
                        >
                          ⟳
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-dim mb-2">{panel.description}</p>
                    {panel.renderPrompt && (
                      <details className="text-sm">
                        <summary className="text-dim cursor-pointer">Render prompt</summary>
                        <pre className="mt-2 text-xs text-dim" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {panel.renderPrompt}
                        </pre>
                      </details>
                    )}
                    {panel.dialogueLines?.length > 0 && (
                      <div className="mt-2">
                        <p className="text-sm font-bold mb-2">Dialogue:</p>
                        {panel.dialogueLines.map((d, i) => (
                          <div key={i} className="text-sm text-dim">
                            <span className="font-bold">{d.speaker}:</span> {d.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        project.status !== 'completed' && (
          <div className="card text-center text-dim">
            <p>Pages will appear here once the planning and rendering stages complete.</p>
          </div>
        )
      )}

      {/* Exports */}
      <div className="card">
        <h3 className="font-bold mb-4">Export</h3>
        <div className="flex gap-4 mb-4">
          <button className="primary" onClick={() => onExport('pages')} disabled={detail.pages.length === 0}>
            Export Pages (PNG)
          </button>
          <button className="primary" onClick={() => onExport('mp4')} disabled={detail.pages.length === 0}>
            Export Motion Comic (MP4)
          </button>
        </div>
        {detail.exports.length > 0 && (
          <div className="flex flex-col gap-2">
            {detail.exports.map((exp) => (
              <div key={exp.id} className="flex items-center justify-between text-sm">
                <span>{exp.type.toUpperCase()} — {new Date(exp.createdAt).toLocaleString()}</span>
                <a href={`/api/exports/${exp.id}/download`}>Download</a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
