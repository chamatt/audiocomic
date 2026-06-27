import Link from 'next/link';
import { SettingsForm } from '@/components/SettingsForm';
import { getSettingsAction } from '@/lib/actions';
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await getSettingsAction();

  return (
    <div>
      <nav className="nav">
        <Link href="/" className="nav-brand">AudioComic</Link>
        <Link href="/projects" className="nav-link">Projects</Link>
        <Link href="/settings" className="nav-link">Settings</Link>
      </nav>
      <div className="container">
        <h1 className="mb-4" style={{ fontSize: 24, fontWeight: 700 }}>Provider Settings</h1>
        <div className="card" style={{ maxWidth: 600 }}>
          <SettingsForm initialSettings={settings} />
        </div>
      </div>
    </div>
  );
}
