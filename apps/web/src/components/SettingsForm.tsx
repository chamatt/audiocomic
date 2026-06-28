'use client';

import { useState } from 'react';
import type { ProviderSettings } from '@audiocomic/domain';
import { saveSettingsAction } from '@/lib/actions';

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
    <form onSubmit={onSave} className="flex flex-col gap-4">
      <div>
        <label className="text-sm font-bold mb-2 block">Transcription Provider</label>
        <select value={settings.transcriptionProvider ?? ''} onChange={(e) => update('transcriptionProvider', (e.target.value || undefined) as ProviderSettings['transcriptionProvider'])}>
          <option value="">Auto (from env)</option>
          <option value="openai">OpenAI Whisper</option>
          <option value="deepgram">Deepgram</option>
          <option value="groq">Groq</option>
          <option value="assemblyai">AssemblyAI</option>
          <option value="fal">Fal</option>
        </select>
      </div>

      <div>
        <label className="text-sm font-bold mb-2 block">LLM Provider</label>
        <select value={settings.llmProvider ?? ''} onChange={(e) => update('llmProvider', (e.target.value || undefined) as ProviderSettings['llmProvider'])}>
          <option value="">Auto (from env)</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google</option>
          <option value="groq">Groq</option>
          <option value="mistral">Mistral</option>
        </select>
      </div>

      <div>
        <label className="text-sm font-bold mb-2 block">LLM Model</label>
        <input
          value={settings.llmModel ?? ''}
          onChange={(e) => update('llmModel', e.target.value || undefined)}
          placeholder="gpt-4o"
        />
      </div>

      <div>
        <label className="text-sm font-bold mb-2 block">Image Provider</label>
        <select value={settings.imageProvider ?? ''} onChange={(e) => update('imageProvider', (e.target.value || undefined) as ProviderSettings['imageProvider'])}>
          <option value="">Auto (from env)</option>
          <option value="comfyui">ComfyUI (open models)</option>
          <option value="openai">OpenAI (DALL-E / gpt-image)</option>
          <option value="fal">Fal</option>
          <option value="stability">Stability AI</option>
          <option value="placeholder">Placeholder (no GPU needed)</option>
        </select>
      </div>

      <div>
        <label className="text-sm font-bold mb-2 block">Image Model</label>
        <input
          value={settings.imageModel ?? ''}
          onChange={(e) => update('imageModel', e.target.value || undefined)}
          placeholder="gpt-image-1-mini"
        />
      </div>

      <div>
        <label className="text-sm font-bold mb-2 block">Renderer Backend</label>
        <select value={settings.rendererBackend ?? ''} onChange={(e) => update('rendererBackend', (e.target.value || undefined) as ProviderSettings['rendererBackend'])}>
          <option value="">Auto (from env)</option>
          <option value="comfyui">ComfyUI</option>
          <option value="aisdk">AI SDK</option>
          <option value="placeholder">Placeholder</option>
        </select>
      </div>

      <div>
        <label className="text-sm font-bold mb-2 block">TTS Provider</label>
        <select value={settings.ttsProvider ?? ''} onChange={(e) => update('ttsProvider', (e.target.value || undefined) as ProviderSettings['ttsProvider'])}>
          <option value="">Auto (from env)</option>
          <option value="openai">OpenAI TTS</option>
          <option value="elevenlabs">ElevenLabs</option>
          <option value="coqui">Coqui</option>
        </select>
      </div>

      <div>
        <label className="text-sm font-bold mb-2 block">TTS Voice</label>
        <input
          value={settings.ttsVoice ?? ''}
          onChange={(e) => update('ttsVoice', e.target.value || undefined)}
          placeholder="alloy"
        />
      </div>

      <div className="flex items-center gap-4">
        <button type="submit" className="primary">Save Settings</button>
        {saved && <span className="text-sm" style={{ color: 'var(--success)' }}>✓ Saved</span>}
      </div>
    </form>
  );
}
