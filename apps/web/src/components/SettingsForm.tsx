'use client';

import { useState } from 'react';
import type { ProviderSettings } from '@audiocomic/domain';
import { saveSettingsAction } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check } from 'lucide-react';

interface Props {
  initialSettings: ProviderSettings;
}

export function SettingsForm({ initialSettings }: Props) {
  const [settings, setSettings] = useState<ProviderSettings>(initialSettings);
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof ProviderSettings>(key: K, value: ProviderSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveSettingsAction(settings);
    setSaved(true);
  };

  return (
    <form onSubmit={onSave} className="flex flex-col gap-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">LLM</CardTitle>
          <CardDescription>Language model for story planning, beats, and panel hints</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label>Provider</Label>
              <Select value={settings.llmProvider} onValueChange={(v) => update('llmProvider', v as ProviderSettings['llmProvider'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Model</Label>
              <Input value={settings.llmModel} onChange={(e) => update('llmModel', e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transcription</CardTitle>
          <CardDescription>Speech-to-text for audio modality</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <Label>Provider</Label>
            <Select value={settings.transcriptionProvider ?? 'groq'} onValueChange={(v) => update('transcriptionProvider', v as ProviderSettings['transcriptionProvider'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="groq">Groq</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="deepgram">Deepgram</SelectItem>
                <SelectItem value="assemblyai">AssemblyAI</SelectItem>
                <SelectItem value="fal">Fal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Image Rendering</CardTitle>
          <CardDescription>Panel art generation backend</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label>Backend</Label>
              <Select value={settings.rendererBackend} onValueChange={(v) => update('rendererBackend', v as ProviderSettings['rendererBackend'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pollinations">Pollinations</SelectItem>
                  <SelectItem value="aisdk">AI SDK</SelectItem>
                  <SelectItem value="comfyui">ComfyUI</SelectItem>
                  <SelectItem value="placeholder">Placeholder</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Image Provider</Label>
              <Select value={settings.imageProvider} onValueChange={(v) => update('imageProvider', v as ProviderSettings['imageProvider'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pollinations">Pollinations</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="fal">Fal</SelectItem>
                  <SelectItem value="stability">Stability</SelectItem>
                  <SelectItem value="comfyui">ComfyUI</SelectItem>
                  <SelectItem value="placeholder">Placeholder</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Image Model</Label>
              <Input value={settings.imageModel} onChange={(e) => update('imageModel', e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>TTS Provider</Label>
              <Select value={settings.ttsProvider ?? 'openai'} onValueChange={(v) => update('ttsProvider', v as ProviderSettings['ttsProvider'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                  <SelectItem value="coqui">Coqui</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit">Save Settings</Button>
        {saved && (
          <span className="text-sm text-success flex items-center gap-1.5">
            <Check className="h-4 w-4" />
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
