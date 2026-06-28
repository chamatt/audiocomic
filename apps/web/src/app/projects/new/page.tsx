import { Nav } from '@/components/Nav';
import { NewProjectForm } from '@/components/NewProjectForm';

export default function NewProjectPage() {
  return (
    <div>
      <Nav />
      <div className="mx-auto max-w-7xl px-6 py-12">
        <h1 className="text-2xl font-bold tracking-tight mb-8">New Project</h1>
        <NewProjectForm />
      </div>
    </div>
  );
}
