import Link from 'next/link';
import { listProjects } from '@/lib/actions';
export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <div>
      <nav className="nav">
        <Link href="/" className="nav-brand">AudioComic</Link>
        <Link href="/projects" className="nav-link">Projects</Link>
        <Link href="/settings" className="nav-link">Settings</Link>
      </nav>
      <div className="container">
        <div className="flex items-center justify-between mb-4">
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Projects</h1>
          <Link href="/projects/new">
            <button className="primary">New Project</button>
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="card text-center text-dim">
            <p>No projects yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="page-grid">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="page-card">
                <div className="page-card-body">
                  <h3 className="font-bold mb-2">{p.name}</h3>
                  <p className="text-sm text-dim mb-2">{p.description ?? 'No description'}</p>
                  <div className="flex items-center gap-2">
                    <span className={`badge badge-${p.status}`}>{p.status}</span>
                    <span className="text-sm text-dim">{p.modality}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
