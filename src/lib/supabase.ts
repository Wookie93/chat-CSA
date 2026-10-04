import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { cache } from 'react';
import type { Database, AppSettingsRow } from '@/types/supabase';

const singletonId = '550e8400-e29b-41d4-a716-446655440000';

// Lazy initialization keeps builds independent of production secrets.
function getServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Database is not configured');
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const getAppSettings = cache(async () => {
  const { data, error } = await getServerClient().from('app_settings')
    .select('*').eq('id', singletonId).maybeSingle<AppSettingsRow>();
  if (error) throw new Error('Failed to fetch app settings');
  return data ?? {
    id: singletonId, openrouter_api_key: '', openrouter_model: 'openai/gpt-4o-mini',
    system_prompt: 'You are a helpful AI assistant.',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
});

export async function updateAppSettings(settings: {
  openrouter_api_key: string; openrouter_model: string; system_prompt: string;
}) {
  const client = getServerClient();
  // Empty input means preserve the secret, without reading it into the browser or
  // writing a stale copy back over a concurrent key rotation.
  if (!settings.openrouter_api_key) {
    const { data, error } = await client.from('app_settings').update({
      openrouter_model: settings.openrouter_model, system_prompt: settings.system_prompt,
      updated_at: new Date().toISOString(),
    }).eq('id', singletonId).select('id').maybeSingle();
    if (error || !data) throw new Error('Provide an API key for initial configuration');
    return;
  }
  const { error } = await client.from('app_settings').upsert({
    id: singletonId, ...settings, updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error('Failed to update settings');
}
