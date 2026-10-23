import { beforeEach, expect, it, vi } from 'vitest';
import { readChatStream } from '@/lib/chat-stream';
import { updateSettingsSchema } from '@/lib/schemas';
const mocks = vi.hoisted(() => ({ settings: vi.fn(), jev: vi.fn(), llm: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getAppSettings: mocks.settings }));
vi.mock('@/lib/jev-calculator', () => ({ calculateWithJev: mocks.jev }));
vi.mock('ai', () => ({ streamText: mocks.llm }));
vi.mock('@openrouter/ai-sdk-provider', () => ({ createOpenRouter: () => ({ chat: (model: string) => model }) }));
import { POST } from '@/app/api/chat/route';
const authorization = 'Basic ' + Buffer.from('admin:test-password-at-least-16').toString('base64');
const message = { role: 'user', content: 'Clock 17 — 20 strzałów, jedna osoba.' };
beforeEach(() => {
  vi.stubEnv('APP_PASSWORD', 'test-password-at-least-16');
  vi.stubEnv('NODE_ENV', 'test');
  mocks.settings.mockReset(); mocks.jev.mockReset(); mocks.llm.mockReset();
});
const request = () => new Request('https://app.test/api/chat', {
  method: 'POST', headers: { authorization, origin: 'https://app.test' }, body: JSON.stringify({ messages: [message] }),
});
it('routes Jev mode through deterministic pricing and preserves the chat stream protocol', async () => {
  mocks.settings.mockResolvedValue({ calculator_mode: 'jev', openrouter_api_key: 'server-secret' });
  mocks.jev.mockResolvedValue('Glock 17: 20 strzałów. Razem: 210,00 zł.');
  const response = await POST(request());
  expect(response.status).toBe(200);
  let result = '';
  await readChatStream(response.body!, text => { result += text; });
  expect(result).toContain('210,00 zł');
  expect(mocks.jev).toHaveBeenCalledWith([message], 'server-secret', expect.any(AbortSignal));
  expect(mocks.llm).not.toHaveBeenCalled();
});
it('keeps the configured model and prompt in LLM mode', async () => {
  mocks.settings.mockResolvedValue({ calculator_mode: 'llm', openrouter_api_key: 'server-secret', openrouter_model: 'test/model', system_prompt: 'saved prompt' });
  mocks.llm.mockReturnValue({ fullStream: (async function* () { yield { type: 'text-delta', text: 'Odpowiedź LLM' }; yield { type: 'finish' }; })() });
  const response = await POST(request());
  let result = '';
  await readChatStream(response.body!, text => { result += text; });
  expect(result).toBe('Odpowiedź LLM');
  expect(mocks.llm).toHaveBeenCalledWith(expect.objectContaining({ model: 'test/model', system: 'saved prompt' }));
  expect(mocks.jev).not.toHaveBeenCalled();
});
it('rejects unknown calculator modes', () => {
  expect(updateSettingsSchema.safeParse({ calculator_mode: 'unknown', openrouter_api_key: '', openrouter_model: 'model', system_prompt: 'prompt' }).success).toBe(false);
});
