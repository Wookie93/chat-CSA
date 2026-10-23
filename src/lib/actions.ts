'use server';

import { revalidatePath } from 'next/cache';
import { updateSettingsSchema } from './schemas';
import { updateAppSettings, updateCalculatorMode } from './supabase';
import { z } from 'zod';
import { requireAppAccess } from './access';

export async function changeCalculatorMode(mode: 'llm' | 'jev') {
  await requireAppAccess();
  try {
    const validatedMode = updateSettingsSchema.shape.calculator_mode.parse(mode);
    await updateCalculatorMode(validatedMode);
    revalidatePath('/admin/settings');
    revalidatePath('/');
    revalidatePath('/chat');
    return { success: true };
  } catch (error) {
    console.error('Failed to change calculator mode:', error);
    return { success: false, error: 'Nie udało się zmienić trybu. Spróbuj ponownie.' };
  }
}

export async function updateSettings(formData: FormData) {
  await requireAppAccess();
  try {
    // Extract form data
    const data = {
      calculator_mode: formData.get('calculator_mode') ?? 'llm',
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
    revalidatePath('/');
    revalidatePath('/chat');

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
