import { getAppSettings } from '@/lib/supabase';
import { AdminSettingsForm } from '@/components/admin-settings-form';
import { Separator } from '@/components/ui/separator';

export default async function AdminSettingsPage() {
  // Fetch initial settings server-side
  const settings = await getAppSettings();

  return (
    <div className="flex-1">
      <div className="flex items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Admin Settings</h1>
          <p className="text-sm text-muted-foreground">Configure your chat application</p>
        </div>
      </div>
      <Separator className="mb-6" />
      <AdminSettingsForm initialSettings={settings} />
    </div>
  );
}