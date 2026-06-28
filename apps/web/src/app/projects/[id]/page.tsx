import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { notFound } from 'next/navigation';
import { getProjectAction, getProjectDetail } from '@/lib/actions';
import { ProjectDetail } from '@/components/ProjectDetail';
export const dynamic = 'force-dynamic';

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
      <Nav />
      <div className="container">
        <ProjectDetail projectId={id} initialProject={project} initialDetail={detail} />
      </div>
    </div>
  );
}
