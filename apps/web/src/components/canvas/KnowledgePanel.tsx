'use client';

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface KnowledgePanelProps {
  projectId: string;
}

interface CharacterEntry {
  id: string;
  name: string;
  role: string;
  description: string;
  aliases: string[];
  paletteNotes: string[];
  negativeConstraints: string[];
}

interface WorldEntry {
  id: string;
  setting: string;
  genre: string[];
  tone: string;
  artStyle: string;
  colorPalette: string[];
  artStyleNegative: string[];
}

interface KnowledgePageEntry {
  id: string;
  title: string;
  type: string;
  content: string;
  updatedAt: string;
}

interface TimelineEntry {
  id: string;
  characterName: string;
  chapterTitle: string;
  chapterIndex: number;
  outfit: string | null;
  location: string | null;
  mood: string | null;
  notes: string | null;
}

type Tab = 'characters' | 'world' | 'timeline';

export function KnowledgePanel({ projectId }: KnowledgePanelProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('characters');
  const [characters, setCharacters] = useState<CharacterEntry[]>([]);
  const [world, setWorld] = useState<WorldEntry[]>([]);
  const [pages, setPages] = useState<KnowledgePageEntry[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [charRes, worldRes, tlRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/knowledge/characters`),
        fetch(`/api/projects/${projectId}/knowledge/world`),
        fetch(`/api/projects/${projectId}/knowledge/timeline`),
      ]);
      if (charRes.ok) {
        const data = await charRes.json() as { characters: CharacterEntry[] };
        setCharacters(data.characters);
      }
      if (worldRes.ok) {
        const data = await worldRes.json() as { world: WorldEntry[]; pages: KnowledgePageEntry[] };
        setWorld(data.world);
        setPages(data.pages);
      }
      if (tlRes.ok) {
        const data = await tlRes.json() as { timeline: TimelineEntry[] };
        setTimeline(data.timeline);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Loading knowledge base...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab selector */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        {(['characters', 'world', 'timeline'] as Tab[]).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={tab === t ? 'default' : 'ghost'}
            className="h-7 text-xs capitalize"
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {tab === 'characters' && (
            characters.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No characters extracted yet. They appear after chapters are ingested.
              </p>
            ) : (
              characters.map((c) => (
                <CharacterEditor
                  key={c.id}
                  character={c}
                  allCharacters={characters}
                  projectId={projectId}
                  onRefresh={fetchData}
                />
              ))
            )
          )}

          {tab === 'world' && (
            <>
              {world.length === 0 && pages.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No world info extracted yet. It appears after chapters are ingested.
                </p>
              ) : (
                <>
                  {world.map((w) => (
                    <WorldBibleEditor key={w.id} world={w} projectId={projectId} />
                  ))}
                  {pages.map((p) => (
                    <Card key={p.id} className="p-3">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'text-xs px-1.5 py-0.5 rounded font-medium',
                          'bg-muted text-muted-foreground',
                        )}>{p.type}</span>
                        <p className="text-sm font-medium truncate">{p.title}</p>
                      </div>
                      {p.content && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{p.content}</p>
                      )}
                    </Card>
                  ))}
                </>
              )}
            </>
          )}

          {tab === 'timeline' && (
            timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No character state changes yet. They appear after chapters are planned.
              </p>
            ) : (
              timeline.map((t) => (
                <Card key={t.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{t.characterName}</p>
                    <span className="text-xs text-muted-foreground">Ch. {t.chapterIndex + 1}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {t.outfit && <span className="text-xs text-muted-foreground">👕 {t.outfit}</span>}
                    {t.location && <span className="text-xs text-muted-foreground">📍 {t.location}</span>}
                    {t.mood && <span className="text-xs text-muted-foreground">🎭 {t.mood}</span>}
                  </div>
                  {t.notes && <p className="text-xs text-muted-foreground mt-1">{t.notes}</p>}
                </Card>
              ))
            )
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// --- World Bible Editor ---

function WorldBibleEditor({
  world,
  projectId,
}: {
  world: WorldEntry;
  projectId: string;
}): JSX.Element {
  const [artStyle, setArtStyle] = useState(world.artStyle ?? '');
  const [tone, setTone] = useState(world.tone ?? '');
  const [colorPalette, setColorPalette] = useState<string[]>(world.colorPalette ?? []);
  const [artStyleNegative, setArtStyleNegative] = useState<string[]>(world.artStyleNegative ?? []);
  const [paletteInput, setPaletteInput] = useState('');
  const [negInput, setNegInput] = useState('');
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced save — patches the world bible after user stops editing.
  const scheduleSave = useCallback(
    (patch: Partial<WorldEntry>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          await fetch(`/api/projects/${projectId}/bible`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
        } catch { /* ignore */ }
        setSaving(false);
      }, 800);
    },
    [projectId],
  );

  const updateArtStyle = (v: string) => {
    setArtStyle(v);
    scheduleSave({ artStyle: v });
  };
  const updateTone = (v: string) => {
    setTone(v);
    scheduleSave({ tone: v });
  };

  const addPaletteTag = () => {
    const tag = paletteInput.trim();
    if (!tag || colorPalette.includes(tag)) return;
    const next = [...colorPalette, tag];
    setColorPalette(next);
    setPaletteInput('');
    scheduleSave({ colorPalette: next });
  };
  const removePaletteTag = (tag: string) => {
    const next = colorPalette.filter((t) => t !== tag);
    setColorPalette(next);
    scheduleSave({ colorPalette: next });
  };

  const addNegTag = () => {
    const tag = negInput.trim();
    if (!tag || artStyleNegative.includes(tag)) return;
    const next = [...artStyleNegative, tag];
    setArtStyleNegative(next);
    setNegInput('');
    scheduleSave({ artStyleNegative: next });
  };
  const removeNegTag = (tag: string) => {
    const next = artStyleNegative.filter((t) => t !== tag);
    setArtStyleNegative(next);
    scheduleSave({ artStyleNegative: next });
  };

  return (
    <Card className="p-3 space-y-3">
      <div>
        <p className="text-sm font-medium">{world.setting}</p>
        {world.genre.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">Genre: {world.genre.join(', ')}</p>
        )}
      </div>

      {/* Art Style — global, always applied to every panel */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Art Style {saving && '· saving...'}
        </label>
        <Textarea
          value={artStyle}
          onChange={(e) => updateArtStyle(e.target.value)}
          placeholder="e.g. comic book art, bold ink lines, cel shading, vibrant colors, expressive faces"
          rows={3}
          className="text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Applied to every panel for visual consistency.
        </p>
      </div>

      {/* Tone — global default, overridden per-scene */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Tone (global default)</label>
        <Input
          value={tone}
          onChange={(e) => updateTone(e.target.value)}
          placeholder="e.g. tense, comedic, dark"
          className="text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Per-scene tones override this for individual panels.
        </p>
      </div>

      {/* Color Palette — tag list */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Color Palette</label>
        {colorPalette.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {colorPalette.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
              >
                {tag}
                <button
                  onClick={() => removePaletteTag(tag)}
                  className="text-primary/50 hover:text-primary"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          <Input
            value={paletteInput}
            onChange={(e) => setPaletteInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPaletteTag(); } }}
            placeholder="Add color tag..."
            className="text-xs h-7"
          />
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={addPaletteTag}>+</Button>
        </div>
      </div>

      {/* Negative Style — tag list */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Negative Style</label>
        {artStyleNegative.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {artStyleNegative.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive"
              >
                {tag}
                <button
                  onClick={() => removeNegTag(tag)}
                  className="text-destructive/50 hover:text-destructive"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          <Input
            value={negInput}
            onChange={(e) => setNegInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNegTag(); } }}
            placeholder="Add negative tag..."
            className="text-xs h-7"
          />
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={addNegTag}>+</Button>
        </div>
      </div>
    </Card>
  );
}

// --- Character Editor ---

const ROLES = ['protagonist', 'antagonist', 'supporting', 'minor', 'narrator'] as const;

function CharacterEditor({
  character,
  allCharacters,
  projectId,
  onRefresh,
}: {
  character: CharacterEntry;
  allCharacters: CharacterEntry[];
  projectId: string;
  onRefresh: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(character.name);
  const [role, setRole] = useState(character.role);
  const [description, setDescription] = useState(character.description);
  const [aliases, setAliases] = useState<string[]>(character.aliases ?? []);
  const [aliasInput, setAliasInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [merging, setMerging] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced save — patches the character after user stops editing.
  const scheduleSave = useCallback(
    (patch: Record<string, unknown>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          await fetch(`/api/projects/${projectId}/knowledge/characters`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ characterId: character.id, ...patch }),
          });
        } catch { /* ignore */ }
        setSaving(false);
      }, 800);
    },
    [projectId, character.id],
  );

  const updateName = (v: string) => { setName(v); scheduleSave({ name: v }); };
  const updateRole = (v: string) => { setRole(v); scheduleSave({ role: v }); };
  const updateDescription = (v: string) => { setDescription(v); scheduleSave({ description: v }); };

  const addAlias = () => {
    const tag = aliasInput.trim();
    if (!tag || aliases.includes(tag)) return;
    const next = [...aliases, tag];
    setAliases(next);
    setAliasInput('');
    scheduleSave({ aliases: next });
  };
  const removeAlias = (tag: string) => {
    const next = aliases.filter((t) => t !== tag);
    setAliases(next);
    scheduleSave({ aliases: next });
  };

  const handleCleanup = async () => {
    setCleaningUp(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup', characterId: character.id }),
      });
      if (res.ok) {
        onRefresh();
      }
    } catch { /* ignore */ }
    setCleaningUp(false);
  };

  const handleMerge = async () => {
    if (!mergeTarget || mergeTarget === character.id) return;
    setMerging(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', sourceId: character.id, targetId: mergeTarget }),
      });
      if (res.ok) {
        onRefresh();
      }
    } catch { /* ignore */ }
    setMerging(false);
    setMergeTarget('');
  };

  const otherCharacters = allCharacters.filter((c) => c.id !== character.id);

  return (
    <Card className="p-3">
      {/* Header — click to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{name}</p>
          <p className="text-xs text-muted-foreground">{role}</p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {expanded ? '▼' : '▶'}
        </span>
      </button>

      {/* Collapsed preview */}
      {!expanded && (
        <>
          {description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{description}</p>
          )}
          {aliases.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Also: {aliases.join(', ')}
            </p>
          )}
        </>
      )}

      {/* Expanded editor */}
      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => updateName(e.target.value)}
              className="text-xs h-8"
            />
          </div>

          {/* Role */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Role</label>
            <Select value={role} onValueChange={updateRole}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Description {saving && '· saving...'}
            </label>
            <Textarea
              value={description}
              onChange={(e) => updateDescription(e.target.value)}
              placeholder="Physical appearance — what the artist needs to draw this character"
              rows={4}
              className="text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Visual details only. Editing this marks related panels stale for re-optimization.
            </p>
          </div>

          {/* Aliases */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Aliases</label>
            {aliases.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {aliases.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                  >
                    {tag}
                    <button
                      onClick={() => removeAlias(tag)}
                      className="text-primary/50 hover:text-primary"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <Input
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }}
                placeholder="Add alias..."
                className="text-xs h-7"
              />
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={addAlias}>+</Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1 border-t">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={handleCleanup}
              disabled={cleaningUp}
            >
              {cleaningUp ? 'Cleaning...' : 'Cleanup (LLM)'}
            </Button>
            {otherCharacters.length > 0 && (
              <div className="flex items-center gap-1">
                <Select value={mergeTarget} onValueChange={setMergeTarget}>
                  <SelectTrigger className="h-7 text-xs w-32">
                    <SelectValue placeholder="Merge into..." />
                  </SelectTrigger>
                  <SelectContent>
                    {otherCharacters.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={handleMerge}
                  disabled={merging || !mergeTarget}
                >
                  {merging ? '...' : 'Merge'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
