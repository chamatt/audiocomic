'use client';

/**
 * Root error boundary — catches errors in any route segment that
 * doesn't have its own error.tsx. Shows a recovery UI with a retry
 * button. Must be a client component.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          {error.message || 'An unexpected error occurred.'}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/60">Error ID: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
