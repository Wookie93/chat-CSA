import { createClient } from '@supabase/supabase-js';
import { cache } from 'react';
import type { Database } from '@/types/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Note: For full type safety, run `supabase gen types typescript` to generate proper types
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side client for server actions and API routes
export const supabaseServer = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // For server-side operations
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Helper function to fetch app settings (server-side only) - cached for performance
export const getAppSettings = cache(async () => {
  const { data, error } = await supabaseServer
    .from('app_settings')
    .select('*')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows found, return default settings
      return {
        id: '550e8400-e29b-41d4-a716-446655440000',
        openrouter_api_key: '',
        openrouter_model: 'openai/gpt-4o-mini',

        system_prompt: 'You are a helpful AI assistant.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
    throw new Error(`Failed to fetch app settings: ${error.message}`);
  }

  return data;
});

// Helper function to update app settings (server-side only)
export async function updateAppSettings(settings: {
  openrouter_api_key: string;
  openrouter_model: string;
  system_prompt: string;
}) {
  // For singleton pattern, upsert with fixed UUID
  const singletonId = '550e8400-e29b-41d4-a716-446655440000'; // Fixed UUID for singleton
  const { data, error } = await supabaseServer
    .from('app_settings')
    .upsert(
      {
        id: singletonId,
        openrouter_api_key: settings.openrouter_api_key,
        openrouter_model: settings.openrouter_model,
        system_prompt: settings.system_prompt,
      },
      { onConflict: 'id' }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update app settings: ${error.message}`);
  }

  return data;
}