import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { NewProjectForm } from '@/components/NewProjectForm';

export default function NewProjectPage() {
  return (
    <div>
      <Nav />
      <div className="container">
        <h1 className="mb-4" style={{ fontSize: 24, fontWeight: 700 }}>New Project</h1>
        <div className="card" style={{ maxWidth: 600 }}>
          <NewProjectForm />
        </div>
      </div>
    </div>
  );
}
