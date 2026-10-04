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
  openrouter_api_key: z.string().trim().max(512),
  openrouter_model: z.string().trim().min(1, 'Model is required').max(200),
  system_prompt: z.string().trim().min(1, 'System prompt is required').max(16000),
});

// Schema for chat messages (for validation if needed)
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1, 'Message content is required').max(16000),
});

// TypeScript types inferred from schemas
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(100).refine(
    (messages) => messages.reduce((size, message) => size + message.content.length, 0) <= 64000,
    'Conversation is too long. Start a new chat.',
  ),
});
