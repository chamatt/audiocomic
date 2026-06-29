'use client';

/**
 * Global error boundary — catches errors that escape the root layout
 * itself (e.g. errors thrown in layout.tsx). This is required by Next.js
 * App Router as the outermost error boundary. Must be a client component
 * and must render its own <html> and <body> tags.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <div className="flex min-h-screen items-center justify-center bg-background p-8">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-bold text-foreground">Application error</h1>
            <p className="text-sm text-muted-foreground">
              {error.message || 'A critical error occurred.'}
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
      </body>
    </html>
  );
}
