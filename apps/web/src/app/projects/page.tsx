import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { listProjects } from '@/lib/actions';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<string, 'default' | 'destructive' | 'success' | 'warning' | 'outline'> = {
  created: 'default',
  ingesting: 'warning',
  planning: 'warning',
  rendering: 'warning',
  composing: 'warning',
  exporting: 'warning',
  completed: 'success',
  failed: 'destructive',
};

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <div>
      <Nav />
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <Link href="/projects/new">
            <Button>New Project</Button>
          </Link>
        </div>

        {projects.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-muted-foreground">No projects yet. Create one to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="py-5">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="font-semibold tracking-tight">{p.name}</h3>
                      <Badge variant={STATUS_VARIANT[p.status] ?? 'outline'}>{p.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {p.description ?? 'No description'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-3 capitalize">{p.modality}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
