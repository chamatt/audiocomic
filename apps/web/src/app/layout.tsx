import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AudioComic — Audiobook to Narrated Comic',
  description: 'Convert audiobooks and books into narrated comic books and motion comics',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
