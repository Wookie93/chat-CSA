import { z } from 'zod';

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('done') }),
]);

export type ChatStreamEvent = z.infer<typeof eventSchema>;

// Use framed events so provider failures are not mistaken for a successful EOF.
export function createChatStreamResponse(
  parts: AsyncIterable<{ type: string; text?: string }>,
  abort: () => void,
) {
  const encoder = new TextEncoder();
  const iterator = parts[Symbol.asyncIterator]();
  let ended = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };
      try {
        while (!ended) {
          const { value, done } = await iterator.next();
          if (ended) return;
          if (done) throw new Error('Provider stream ended without a finish event');
          if (value.type === 'finish') {
            ended = true;
            send({ type: 'done' });
            controller.close();
            return;
          }
          if (value.type === 'error' || value.type === 'abort') {
            throw new Error('Provider stream failed');
          }
          if (value.type === 'text-delta' && value.text) {
            send({ type: 'text', text: value.text });
            return;
          }
        }
      } catch {
        if (ended) return;
        ended = true;
        send({ type: 'error', message: 'Nie udało się wygenerować odpowiedzi. Spróbuj ponownie.' });
        controller.close();
        abort();
      }
    },
    cancel() {
      ended = true;
      abort();
      void iterator.return?.();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  let hasText = false;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = eventSchema.parse(JSON.parse(line));
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'done') finished = true;
    if (event.type === 'text') {
      hasText ||= event.text.trim().length > 0;
      onText(event.text);
    }
  }
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (finished) break;
      }
      if (done) {
        if (buffer.trim()) consume(buffer);
        break;
      }
    }
    if (!finished) throw new Error('Połączenie zostało przerwane. Spróbuj ponownie.');
    if (!hasText) throw new Error('Model zwrócił pustą odpowiedź. Spróbuj ponownie.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
