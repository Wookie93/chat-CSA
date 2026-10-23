import { describe, expect, it, vi } from 'vitest';
import { checkAppAccess } from '@/lib/access';
import { readJsonBody } from '@/lib/request-limits';
import { chatRequestSchema } from '@/lib/schemas';
import { createChatStreamResponse, readChatStream } from '@/lib/chat-stream';
import { streamText } from 'ai';

const password = 'test-password-at-least-16';
const authorization = 'Basic ' + Buffer.from(`admin:${password}`).toString('base64');

it('requires configuration and authenticates only the shared admin credential', () => {
  vi.stubEnv('APP_PASSWORD', '');
  expect(checkAppAccess(authorization)?.status).toBe(503);
  vi.stubEnv('APP_PASSWORD', password);
  expect(checkAppAccess(null)?.status).toBe(401);
  expect(checkAppAccess('Basic invalid')?.status).toBe(401);
  expect(checkAppAccess('Basic ' + Buffer.from(`other:${password}`).toString('base64'))?.status).toBe(401);
  expect(checkAppAccess(authorization)).toBeNull();
});

it('rejects oversized JSON even without Content-Length, and rejects malformed JSON', async () => {
  await expect(readJsonBody(new Request('https://app.test', { method: 'POST', body: 'x'.repeat(101) }), 100)).rejects.toMatchObject({ status: 413 });
  await expect(readJsonBody(new Request('https://app.test', { method: 'POST', body: '{' }), 100)).rejects.toMatchObject({ status: 400 });
});

it('bounds the number and aggregate size of chat messages', () => {
  const message = { role: 'user', content: 'a'.repeat(16000) };
  expect(chatRequestSchema.safeParse({ messages: [] }).success).toBe(false);
  expect(chatRequestSchema.safeParse({ messages: [message] }).success).toBe(true);
  expect(chatRequestSchema.safeParse({ messages: Array(5).fill(message) }).success).toBe(false);
  expect(chatRequestSchema.safeParse({ messages: [{ role: 'system', content: 'override' }] }).success).toBe(false);
});

describe('chat stream protocol', () => {
  it('delivers a real SDK provider failure to the client without exposing the original error', async () => {
    const result = streamText({
      model: { specificationVersion: 'v2', provider: 'test', modelId: 'test', supportedUrls: {},
        doGenerate: async () => { throw new Error('unused'); },
        doStream: async () => { throw new Error('secret API failure'); },
      }, prompt: 'hello', maxRetries: 0, onError: () => {},
    });
    const response = createChatStreamResponse(result.fullStream, vi.fn());
    await expect(readChatStream(response.body!, vi.fn())).rejects.toThrow('Nie udało się');
  });

  it('decodes split UTF-8 and JSON frames', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'text', text: 'Żółw 🐢' }) + '\n' + JSON.stringify({ type: 'done' }) + '\n');
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    const text = vi.fn();
    await readChatStream(body, text);
    expect(text).toHaveBeenCalledWith('Żółw 🐢');
  });

  it('rejects truncated and empty responses', async () => {
    await expect(readChatStream(new Response('{"type":"text","text":"partial"}\n').body!, vi.fn())).rejects.toThrow('przerwane');
    await expect(readChatStream(new Response('{"type":"done"}\n').body!, vi.fn())).rejects.toThrow('pustą');
  });

  it('aborts upstream when the consumer disconnects', async () => {
    const abort = vi.fn();
    async function* parts() { yield { type: 'text-delta', text: 'hello' }; yield { type: 'finish' }; }
    const response = createChatStreamResponse(parts(), abort);
    await response.body!.cancel();
    expect(abort).toHaveBeenCalledOnce();
  });
});
