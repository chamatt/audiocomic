import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function HomePage() {
  return (
    <div>
      <Nav />
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="flex flex-col gap-2 mb-12">
          <h1 className="text-4xl font-bold tracking-tight">
            Audiobook to narrated comic
          </h1>
          <p className="text-muted-foreground max-w-xl">
            Upload audio or text. The pipeline transcribes, segments, plans pages,
            renders panels, and exports a narrated motion comic.
          </p>
          <div className="flex gap-3 mt-4">
            <Link href="/projects/new">
              <Button>New Project</Button>
            </Link>
            <Link href="/projects">
              <Button variant="outline">Browse Projects</Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ingest</CardTitle>
              <CardDescription>
                Audio is transcribed with word-level timestamps. Text is parsed into
                chapters and scenes.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plan</CardTitle>
              <CardDescription>
                An LLM plans chapters, scenes, beats, pages, and panels as typed JSON.
                Character and world bibles ensure consistency.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Render and Export</CardTitle>
              <CardDescription>
                Panels are rendered, composed with lettering, and exported as a
                narrated MP4 synchronized to the original audio.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  );
}
