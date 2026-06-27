import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectAction, getProjectDetail } from '@/lib/actions';
import { ProjectDetail } from '@/components/ProjectDetail';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const project = await getProjectAction(id);
  if (!project) notFound();

  const detail = await getProjectDetail(id);

  return (
    <div>
      <nav className="nav">
        <Link href="/" className="nav-brand">AudioComic</Link>
        <Link href="/projects" className="nav-link">Projects</Link>
        <Link href="/settings" className="nav-link">Settings</Link>
      </nav>
      <div className="container">
        <ProjectDetail projectId={id} initialProject={project} initialDetail={detail} />
      </div>
    </div>
  );
}
