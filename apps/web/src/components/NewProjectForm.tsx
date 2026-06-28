'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProjectAction } from '@/lib/actions';
import { createProjectActor, createBibleActor, linkBibleActor } from '@/lib/actor-actions';

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modality, setModality] = useState<'audio' | 'text'>('audio');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    if (modality === 'audio' && !file) { setError('Audio file is required'); return; }
    if (modality === 'text' && !text.trim()) { setError('Text content is required'); return; }

    setLoading(true);
    try {
      // 1. Create project in DB
      const fileDataBase64 = file
        ? btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())))
        : undefined;
      const projectId = await createProjectAction({
        name,
        description,
        modality,
        fileName: file?.name,
        fileDataBase64,
        textContent: text,
      });

      // 2. Create project actor + bible actor
      const projectRes = await createProjectActor(name, description);
      if (projectRes.ok) {
        const bibleRes = await createBibleActor(name, `Story bible for ${name}`);
        if (bibleRes.ok) {
          await linkBibleActor(projectRes.data.key, bibleRes.data.content.id);
        }
      }

      router.push(`/projects/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <label className="text-sm text-dim mb-2 block">Project name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Comic Project"
          style={{ width: '100%' }}
        />
      </div>

      <div>
        <label className="text-sm text-dim mb-2 block">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={2}
          style={{ width: '100%' }}
        />
      </div>

      <div>
        <label className="text-sm text-dim mb-2 block">Source type</label>
        <select value={modality} onChange={(e) => setModality(e.target.value as 'audio' | 'text')}>
          <option value="audio">Audio file (MP3, M4B, WAV)</option>
          <option value="text">Text (paste book content)</option>
        </select>
      </div>

      {modality === 'audio' ? (
        <div>
          <label className="text-sm text-dim mb-2 block">Audio file</label>
          <input
            type="file"
            accept="audio/*,.m4b,.mp3,.wav,.flac,.ogg"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && <p className="text-sm text-dim mt-2">{file.name} ({Math.round(file.size / 1024)}KB)</p>}
        </div>
      ) : (
        <div>
          <label className="text-sm text-dim mb-2 block">Book text</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the full text of the book here..."
            rows={10}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
          />
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', padding: '8px 12px' }}>
          {error}
        </div>
      )}

      <button type="submit" className="primary" disabled={loading}>
        {loading ? 'Creating...' : 'Create Project'}
      </button>
    </form>
  );
}
