import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getAppSettings } from '@/lib/supabase';
import { z } from 'zod';
import { chatMessageSchema } from '@/lib/schemas';

// Conditional logging for development only
const isDev = process.env.NODE_ENV === 'development';
const log = isDev ? console.log : () => { };

// Request validation schema
const messagesSchema = z.array(chatMessageSchema);

export async function POST(req: Request) {
  try {
    log('Chat API called');

    // Fetch the latest settings from Supabase (cached)
    const settings = await getAppSettings();
    log('Settings fetched:', { model: settings.openrouter_model, hasApiKey: !!settings.openrouter_api_key });

    // Check if API key is configured
    if (!settings.openrouter_api_key) {
      console.error('No API key configured');
      return new Response('API key not configured. Please configure it in admin settings.', { status: 400 });
    }

    // Create OpenRouter provider (official package handles API format correctly)
    const openrouter = createOpenRouter({
      apiKey: settings.openrouter_api_key,
    });

    // Get and validate the messages from the request
    const body = await req.json();
    const parseResult = messagesSchema.safeParse(body.messages);

    if (!parseResult.success) {
      console.error('Invalid messages format:', parseResult.error.issues);
      return new Response('Invalid message format', { status: 400 });
    }

    // Map messages to correct format (Zod already validates content is string)
    const messages = parseResult.data.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));
    log('Messages received:', messages.length);

    // Stream response with configured model
    log('Starting stream with model:', settings.openrouter_model);
    const result = await streamText({
      model: openrouter.chat(settings.openrouter_model),
      system: settings.system_prompt,
      messages,
      maxOutputTokens: 16384,
      temperature: 0.3,
    });
    log('Stream created successfully');

    const response = result.toTextStreamResponse();
    log('Response created:', response.status);
    return response;
  } catch (error) {
    console.error('Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(`Internal Server Error: ${errorMessage}`, { status: 500 });
  }
}