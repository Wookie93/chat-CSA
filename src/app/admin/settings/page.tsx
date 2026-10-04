import { getAppSettings } from '@/lib/supabase';
import { AdminSettingsForm } from '@/components/admin-settings-form';
import { requireAppAccess } from '@/lib/access';
import { Separator } from '@/components/ui/separator';

export default async function AdminSettingsPage() {
  await requireAppAccess();
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
      <AdminSettingsForm
        initialSettings={{ openrouter_api_key: '', openrouter_model: settings.openrouter_model, system_prompt: settings.system_prompt }}
        hasApiKey={Boolean(settings.openrouter_api_key)}
      />
    </div>
  );
}