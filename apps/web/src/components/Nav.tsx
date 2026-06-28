import Link from 'next/link';

export function Nav() {
  return (
    <nav className="nav">
      <Link href="/" className="nav-brand">AudioComic</Link>
      <Link href="/projects" className="nav-link">Projects</Link>
      <Link href="/settings" className="nav-link">Settings</Link>
    </nav>
  );
}
