import { Nav } from '@/components/Nav';
import { SettingsForm } from '@/components/SettingsForm';
import { getSettingsAction } from '@/lib/actions';
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await getSettingsAction();

  return (
    <div>
      <Nav />
      <div className="mx-auto max-w-7xl px-6 py-12">
        <h1 className="text-2xl font-bold tracking-tight mb-8">Provider Settings</h1>
        <SettingsForm initialSettings={settings} />
      </div>
    </div>
  );
}
