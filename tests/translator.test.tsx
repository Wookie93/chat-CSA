// @vitest-environment jsdom
import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TranslatorPage from '@/app/translator/page';
import { useTranslation } from '@/hooks/use-translation';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
// Keep these tests focused on translator behavior rather than Radix's portal interactions.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) =>
    <select value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('hydrates the counter with different default locales on the server and client', async () => {
  const originalFormat = Number.prototype.toLocaleString;
  let defaultLocale = 'en-US';
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (this: number, locales, options) {
    return originalFormat.call(this, locales ?? defaultLocale, options);
  });
  const container = document.createElement('div');
  container.innerHTML = renderToString(<TranslatorPage />);
  document.body.appendChild(container);
  defaultLocale = 'pl-PL';
  const onRecoverableError = vi.fn();
  let root!: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => { root = hydrateRoot(container, <TranslatorPage />, { onRecoverableError }); });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toContain('0 / 5,000');
  } finally {
    act(() => root?.unmount());
    container.remove();
  }
});

it.each([
  { text: 'Changed input', source: 'EN', target: 'PL' },
  { text: 'Original', source: 'DE', target: 'PL' },
  { text: 'Original', source: 'EN', target: 'FR' },
  { text: '', source: 'EN', target: 'PL' },
])('immediately hides the result and detection when inputs change to %j', async (changed) => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ translatedText: 'Wynik', detectedSourceLang: 'EN' })));
  const { result, rerender } = renderHook(({ text, source, target }) => useTranslation(text, source, target), {
    initialProps: { text: 'Original', source: 'EN', target: 'PL' },
  });
  await act(async () => { await result.current.handleTranslate(); });
  expect(result.current.translatedText).toBe('Wynik');
  rerender(changed);
  expect(result.current.translatedText).toBe('');
  expect(result.current.detectedLang).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(999); });
  expect(result.current.translatedText).toBe('');
});

it('does not restore an old result after the replacement fails', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ translatedText: 'Wynik' }))
    .mockResolvedValueOnce(Response.json({ error: 'Provider unavailable' }, { status: 502 })));
  const { result, rerender } = renderHook(({ text }) => useTranslation(text, 'EN', 'PL'), { initialProps: { text: 'Original' } });
  await act(async () => { await result.current.handleTranslate(); });
  rerender({ text: 'Changed' });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(result.current.translatedText).toBe('');
  expect(result.current.isLoading).toBe(false);
});

it('ignores a response resolving during the replacement debounce', async () => {
  vi.useFakeTimers();
  let resolve!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  const { result, rerender } = renderHook(({ text }) => useTranslation(text, 'EN', 'PL'), { initialProps: { text: 'Original' } });
  let request!: Promise<void>;
  act(() => { request = result.current.handleTranslate(); });
  rerender({ text: 'Changed' });
  await act(async () => { resolve(Response.json({ translatedText: 'Old result' })); await request; });
  expect(result.current.translatedText).toBe('');
  expect(result.current.isLoading).toBe(false);
});

function renderTranslator(target = 'PL') {
  const view = render(<TranslatorPage />);
  const languages = view.getAllByRole('combobox');
  fireEvent.change(languages[0], { target: { value: 'EN' } });
  fireEvent.change(languages[1], { target: { value: target } });
  const input = view.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'Original text' } });
  return { ...view, input, languages };
}

it('protects the source before a result exists and after an API error', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Quota exceeded' }, { status: 429 })));
  const view = renderTranslator();
  const swap = view.getByRole('button', { name: 'Swap languages' }) as HTMLButtonElement;
  expect(swap.disabled).toBe(true);
  fireEvent.click(swap);
  expect(view.input.value).toBe('Original text');
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Translate' })); });
  expect(swap.disabled).toBe(true);
  expect(view.input.value).toBe('Original text');
});

it('blocks copy and swap on edits and allows swapping a current result', async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ translatedText: 'Aktualny wynik' })));
  const view = renderTranslator();
  const swap = view.getByRole('button', { name: 'Swap languages' }) as HTMLButtonElement;
  const copy = view.getByRole('button', { name: 'Copy' }) as HTMLButtonElement;
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Translate' })); });
  expect(swap.disabled).toBe(false);
  expect(copy.disabled).toBe(false);
  await act(async () => { fireEvent.click(copy); });
  expect(writeText).toHaveBeenCalledWith('Aktualny wynik');
  fireEvent.change(view.input, { target: { value: 'Changed text' } });
  expect(swap.disabled).toBe(true);
  expect(copy.disabled).toBe(true);
  fireEvent.click(swap);
  fireEvent.click(copy);
  expect(view.input.value).toBe('Changed text');
  expect(writeText).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Translate' })); });
  fireEvent.click(swap);
  expect(view.input.value).toBe('Aktualny wynik');
  expect((view.languages[0] as HTMLSelectElement).value).toBe('PL');
  expect((view.languages[1] as HTMLSelectElement).value).toBe('EN');
});

it('focuses the synonym dialog and restores focus after Escape or selection', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.startsWith('/api/synonyms')
    ? { synonyms: ['greetings', 'good day'] }
    : { translatedText: 'Hello world' })));
  const view = renderTranslator('EN');
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Translate' })); });
  const word = view.getByRole('button', { name: 'Hello' });
  expect(word.tabIndex).toBe(0);
  act(() => word.focus());
  // Native buttons generate this click for both Enter and Space in browsers.
  await act(async () => { fireEvent.click(word); });
  const dialog = view.getByRole('dialog', { name: 'Synonyms for Hello' });
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(view.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(word);
  await act(async () => { fireEvent.click(word); });
  const option = view.getByRole('button', { name: 'greetings' });
  act(() => option.focus());
  expect(view.getByRole('dialog')).toBeTruthy();
  fireEvent.click(option);
  const replacement = view.getByRole('button', { name: 'Greetings' });
  expect(document.activeElement).toBe(replacement);
  expect(view.queryByRole('dialog')).toBeNull();
  fireEvent.change(view.input, { target: { value: 'New input' } });
  expect(view.queryByRole('button', { name: 'Greetings' })).toBeNull();
});
