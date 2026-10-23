import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getAppSettings } from '@/lib/supabase';
import { chatRequestSchema } from '@/lib/schemas';
import { checkAppAccess, checkMutationOrigin } from '@/lib/access';
import { checkRateLimit, readJsonBody, RequestError } from '@/lib/request-limits';
import { createChatStreamResponse } from '@/lib/chat-stream';
import { calculateWithJev } from '@/lib/jev-calculator';

export async function POST(req: Request) {
  const denied = checkAppAccess(req.headers.get('authorization')) ?? checkMutationOrigin(req);
  if (denied) return denied;
  try {
    const parsed = chatRequestSchema.safeParse(await readJsonBody(req, 300000));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const limited = await checkRateLimit('chat');
    if (limited) return limited;
    const settings = await getAppSettings();
    if (!settings.openrouter_api_key) {
      return Response.json({ error: 'Configure the API key in admin settings.' }, { status: 400 });
    }
    const controller = new AbortController();
    if (settings.calculator_mode === 'jev') {
      const text = await calculateWithJev(parsed.data.messages, settings.openrouter_api_key,
        AbortSignal.any([req.signal, controller.signal, AbortSignal.timeout(60000)]));
      return createChatStreamResponse((async function* () {
        yield { type: 'text-delta', text };
        yield { type: 'finish' };
      })(), () => controller.abort());
    }
    const openrouter = createOpenRouter({ apiKey: settings.openrouter_api_key });
    const result = streamText({
      model: openrouter.chat(settings.openrouter_model),
      system: settings.system_prompt,
      messages: parsed.data.messages,
      maxOutputTokens: 4096,
      temperature: 0.3,
      maxRetries: 1,
      abortSignal: AbortSignal.any([req.signal, controller.signal, AbortSignal.timeout(120000)]),
      onError: () => { console.error('Chat provider request failed'); },
    });
    return createChatStreamResponse(result.fullStream, () => controller.abort());
  } catch (error) {
    if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status });
    console.error('Chat request failed');
    return Response.json({ error: 'Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.' }, { status: 500 });
  }
}
