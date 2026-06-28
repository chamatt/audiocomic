import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { SettingsForm } from '@/components/SettingsForm';
import { getSettingsAction } from '@/lib/actions';
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await getSettingsAction();

  return (
    <div>
      <Nav />
      <div className="container">
        <h1 className="mb-4" style={{ fontSize: 24, fontWeight: 700 }}>Provider Settings</h1>
        <div className="card" style={{ maxWidth: 600 }}>
          <SettingsForm initialSettings={settings} />
        </div>
      </div>
    </div>
  );
}
