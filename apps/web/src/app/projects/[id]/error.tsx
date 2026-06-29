'use client';

/**
 * Project error boundary — catches errors in the project detail page
 * (canvas editor, pipeline DAG, chapter board). Shows a recovery UI
 * with a link back to the projects list.
 */
import Link from 'next/link';

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold text-foreground">Project error</h1>
        <p className="text-sm text-muted-foreground">
          {error.message || 'Failed to load this project.'}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/60">Error ID: {error.digest}</p>
        )}
        <div className="flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
          <Link
            href="/projects"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Back to projects
          </Link>
        </div>
      </div>
    </div>
  );
}
