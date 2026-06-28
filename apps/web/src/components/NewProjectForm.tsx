'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProjectAction } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

      router.push(`/projects/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 max-w-2xl">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Project name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Comic Project"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={2}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Source type</Label>
        <Select value={modality} onValueChange={(v) => setModality(v as 'audio' | 'text')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="audio">Audio file (MP3, M4B, WAV)</SelectItem>
            <SelectItem value="text">Text (paste book content)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {modality === 'audio' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="file">Audio file</Label>
          <Input
            id="file"
            type="file"
            accept="audio/*,.m4b,.mp3,.wav"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <p className="text-xs text-muted-foreground">{file.name} ({Math.round(file.size / 1024)} KB)</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="text">Book text</Label>
          <Textarea
            id="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the full text of the book here..."
            rows={10}
          />
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" disabled={loading} className="w-fit">
        {loading ? 'Creating...' : 'Create Project'}
      </Button>
    </form>
  );
}
