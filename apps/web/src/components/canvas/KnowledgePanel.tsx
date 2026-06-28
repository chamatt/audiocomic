'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
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
}

interface WorldEntry {
  id: string;
  setting: string;
  genre: string[];
  tone: string;
  artStyle: string;
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
                <Card key={c.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.role}</p>
                    </div>
                  </div>
                  {c.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</p>
                  )}
                  {c.aliases.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Also: {c.aliases.join(', ')}
                    </p>
                  )}
                </Card>
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
                    <Card key={w.id} className="p-3">
                      <p className="text-sm font-medium">{w.setting}</p>
                      {w.tone && <p className="text-xs text-muted-foreground mt-1">Tone: {w.tone}</p>}
                      {w.artStyle && <p className="text-xs text-muted-foreground">Style: {w.artStyle}</p>}
                      {w.genre.length > 0 && (
                        <p className="text-xs text-muted-foreground">Genre: {w.genre.join(', ')}</p>
                      )}
                    </Card>
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
