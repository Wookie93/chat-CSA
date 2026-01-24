import { getAppSettings } from '@/lib/supabase';
import { AdminSettingsForm } from '@/components/admin-settings-form';

export default async function AdminSettingsPage() {
  // Fetch initial settings server-side
  const settings = await getAppSettings();

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Admin Settings</h1>
      <AdminSettingsForm initialSettings={settings} />
    </div>
  );
}