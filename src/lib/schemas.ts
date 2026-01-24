import { z } from 'zod';

// Schema for app settings stored in Supabase
export const appSettingsSchema = z.object({
  id: z.string().uuid(),
  openrouter_api_key: z.string().min(1, 'API key is required'),
  openrouter_model: z.string().min(1, 'Model is required'),
  system_prompt: z.string().min(1, 'System prompt is required'),
});

// Schema for updating settings (without id, as it's a singleton)
export const updateSettingsSchema = z.object({
  openrouter_api_key: z.string().min(1, 'API key is required'),
  openrouter_model: z.string().min(1, 'Model is required'),
  system_prompt: z.string().min(1, 'System prompt is required'),
});

// Schema for chat messages (for validation if needed)
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1, 'Message content is required'),
});

// TypeScript types inferred from schemas
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;