'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProjectAction } from '@/lib/actions';

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
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }
    if (modality === 'audio' && !file) {
      setError('Audio file is required');
      return;
    }
    if (modality === 'text' && !text.trim()) {
      setError('Book text is required');
      return;
    }

    setLoading(true);
    try {
      const projectId = await createProjectAction({
        name,
        description,
        modality,
        file,
        text,
      });
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
        <label className="text-sm font-bold mb-2 block">Project Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Audiobook Comic"
          required
        />
      </div>

      <div>
        <label className="text-sm font-bold mb-2 block">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A brief description of this project"
          rows={2}
        />
      </div>

      <div>
        <label className="text-sm font-bold mb-2 block">Input Type</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={modality === 'audio'}
              onChange={() => setModality('audio')}
              style={{ width: 'auto' }}
            />
            Audio file (MP3, WAV, M4A)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={modality === 'text'}
              onChange={() => setModality('text')}
              style={{ width: 'auto' }}
            />
            Book text (TXT, MD)
          </label>
        </div>
      </div>

      {modality === 'audio' ? (
        <div>
          <label className="text-sm font-bold mb-2 block">Audio File</label>
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      ) : (
        <div>
          <label className="text-sm font-bold mb-2 block">Book Text</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the book text here, or upload a text file..."
            rows={10}
          />
          <input
            type="file"
            accept=".txt,.md,text/*"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                const content = await f.text();
                setText(content);
              }
            }}
            className="mt-2"
          />
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <button type="submit" className="primary" disabled={loading}>
        {loading ? 'Creating...' : 'Create & Start Pipeline'}
      </button>
    </form>
  );
}
