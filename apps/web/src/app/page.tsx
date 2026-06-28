import Link from 'next/link';
import { Nav } from '@/components/Nav';

export default function HomePage() {
  return (
    <div>
      <Nav />
      <div className="container">
        <div className="card mb-4">
          <h1 className="mb-2" style={{ fontSize: 32, fontWeight: 800 }}>
            Audiobook → Narrated Comic
          </h1>
          <p className="text-dim mb-4">
            Upload an audiobook or book text. The system transcribes, segments the story,
            plans pages and panels, renders comic art, composes pages with lettering,
            and exports a narrated motion-comic video synchronized to the original audio.
          </p>
          <div className="flex gap-4">
            <Link href="/projects/new">
              <button className="primary">New Project</button>
            </Link>
            <Link href="/projects">
              <button>View Projects</button>
            </Link>
          </div>
        </div>

        <div className="grid grid-3 mt-4">
          <div className="card">
            <h3 className="mb-2 font-bold">1. Ingest</h3>
            <p className="text-sm text-dim">
              Audio is transcribed with word-level timestamps. Text is parsed into
              chapters and scenes. Both modalities produce a normalized story timeline.
            </p>
          </div>
          <div className="card">
            <h3 className="mb-2 font-bold">2. Plan</h3>
            <p className="text-sm text-dim">
              An LLM plans chapters, scenes, beats, pages, and panels as typed JSON.
              Character and world bibles are built for cross-panel consistency.
            </p>
          </div>
          <div className="card">
            <h3 className="mb-2 font-bold">3. Render & Export</h3>
            <p className="text-sm text-dim">
              Panels are rendered through adapter backends (ComfyUI, AI SDK, or placeholder).
              Pages are composed with lettering overlays. FFmpeg exports a narrated MP4.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
