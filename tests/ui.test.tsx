// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTranslation } from '@/hooks/use-translation';
import { useChat } from '@/app/chat/hooks';
import { MessageInput } from '@/components/ui/message-input';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('shiki', () => ({ bundledLanguages: { js: {} }, codeToTokens: vi.fn(async (code: string) => ({ tokens: [[{ content: code, color: '#123456' }]] })) }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('renders fenced code in a client component, including unknown languages', async () => {
  const { container, rerender } = render(<MarkdownRenderer>{'```js\nconst value = 42;\n```'}</MarkdownRenderer>);
  await waitFor(() => expect(container.querySelector('code span')?.textContent).toContain('const value = 42;'));
  rerender(<MarkdownRenderer>{'```unknown-language\nplain code\n```'}</MarkdownRenderer>);
  expect(container.querySelector('pre')?.textContent).toContain('plain code');
});

it('ignores an old translation even if it resolves after the replacement', async () => {
  const pending: Array<(response: Response) => void> = [];
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => pending.push(resolve))));
  const { result, rerender } = renderHook(({ text }) => useTranslation(text, 'EN', 'PL'), { initialProps: { text: 'old' } });
  let first!: Promise<void>;
  act(() => { first = result.current.handleTranslate(); });
  rerender({ text: 'new' });
  let second!: Promise<void>;
  act(() => { second = result.current.handleTranslate(); });
  await act(async () => { pending[1](Response.json({ translatedText: 'nowe' })); await second; });
  await act(async () => { pending[0](Response.json({ translatedText: 'stare' })); await first; });
  expect(result.current.translatedText).toBe('nowe');
  expect(result.current.isLoading).toBe(false);
});

it('clears translation when the input is emptied and cancels pending work', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ translatedText: 'wynik' })));
  const { result, rerender } = renderHook(({ text }) => useTranslation(text, 'EN', 'PL'), { initialProps: { text: 'source' } });
  await act(async () => { await result.current.handleTranslate(); });
  expect(result.current.translatedText).toBe('wynik');
  rerender({ text: '' });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(result.current.translatedText).toBe('');
});

it('manual translation cancels the queued automatic request', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockImplementation(async () => Response.json({ translatedText: 'wynik' }));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useTranslation('hello', 'EN', 'PL'));
  await act(async () => { await result.current.handleTranslate(); await vi.advanceTimersByTimeAsync(1100); });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('awaits abort before sending a replacement chat message', async () => {
  const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useChat());
  act(() => result.current.append({ role: 'user', content: 'first' }));
  await act(async () => { await result.current.stop(); result.current.append({ role: 'user', content: 'replacement' }); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.current.messages.map(message => message.content)).toEqual(['first', 'replacement']);
  await act(async () => { await result.current.stop(); });
});

it('surfaces an error event from the chat server', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"type":"error","message":"Provider failed"}\n')));
  const onError = vi.fn();
  const { result } = renderHook(() => useChat({ onError }));
  await act(async () => { result.current.append({ role: 'user', content: 'hello' }); });
  await waitFor(() => expect(onError).toHaveBeenCalled());
  expect(onError.mock.calls[0][0].message).toBe('Provider failed');
  expect(result.current.messages).toHaveLength(1);
  expect(result.current.isLoading).toBe(false);
});


it('double Enter interrupts and submits the replacement exactly once', async () => {
  const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  vi.stubGlobal('fetch', fetchMock);
  function Harness() {
    const chat = useChat();
    return <form onSubmit={chat.handleSubmit}><MessageInput value={chat.input} onChange={chat.handleInputChange} isGenerating={chat.isGenerating} stop={chat.stop} /></form>;
  }
  const { getByRole } = render(<Harness />);
  const input = getByRole('textbox');
  fireEvent.change(input, { target: { value: 'first' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: 'replacement' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
  expect(body.messages.at(-1).content).toBe('replacement');
});
