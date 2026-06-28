import { Nav } from '@/components/Nav';
import { PipelinePage } from '@/components/PipelinePage';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ key: string }>;
}

export default async function PipelineViewPage({ params }: PageProps) {
  const { key } = await params;

  return (
    <div>
      <Nav />
      <PipelinePage pipelineKey={key} />
    </div>
  );
}
