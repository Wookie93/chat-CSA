'use server';

import { revalidatePath } from 'next/cache';
import { updateSettingsSchema } from './schemas';
import { updateAppSettings } from './supabase';
import { z } from 'zod';

export async function updateSettings(formData: FormData) {
  try {
    // Extract form data
    const data = {
      openrouter_api_key: formData.get('openrouter_api_key') as string,
      openrouter_model: formData.get('openrouter_model') as string,
      system_prompt: formData.get('system_prompt') as string,
    };

    // Validate with Zod
    const validatedData = updateSettingsSchema.parse(data);

    // Update in Supabase
    await updateAppSettings(validatedData);

    // Revalidate the admin page
    revalidatePath('/admin/settings');

    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.issues.map((err: z.ZodIssue) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      };
    }

    console.error('Failed to update settings:', error);
    return {
      success: false,
      error: 'Failed to update settings. Please try again.',
    };
  }
}