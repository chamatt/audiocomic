import Link from 'next/link';
import { NewProjectForm } from '@/components/NewProjectForm';

export default function NewProjectPage() {
  return (
    <div>
      <nav className="nav">
        <Link href="/" className="nav-brand">AudioComic</Link>
        <Link href="/projects" className="nav-link">Projects</Link>
        <Link href="/settings" className="nav-link">Settings</Link>
      </nav>
      <div className="container">
        <h1 className="mb-4" style={{ fontSize: 24, fontWeight: 700 }}>New Project</h1>
        <div className="card" style={{ maxWidth: 600 }}>
          <NewProjectForm />
        </div>
      </div>
    </div>
  );
}
