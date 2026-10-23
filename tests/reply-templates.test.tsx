// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReplyTemplates } from '@/components/ReplyTemplates';
import { DEFAULT_REPLY_TEMPLATES, type ReplyLibrary, type ReplyTemplateCategory } from '@/lib/reply-templates';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const key = 'chat.reply-templates.v1';
let database: ReplyLibrary;
let reviews: ReplyLibrary;
let failSave: boolean;
beforeEach(() => {
  database = { category: 'emails', templates: structuredClone(DEFAULT_REPLY_TEMPLATES), revision: 1 };
  reviews = { category: 'google_reviews', templates: [], revision: 1 };
  failSave = false;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const category: ReplyTemplateCategory = init?.method === 'PUT' ? JSON.parse(init.body as string).category : new URL(_url, 'https://app.test').searchParams.get('category') ?? 'emails';
    const current = category === 'emails' ? database : reviews;
    if (init?.method === 'PUT') {
      if (failSave) return Response.json({ error: 'Błąd połączenia' }, { status: 503 });
      const body = JSON.parse(init.body as string);
      if (body.revision !== current.revision) return Response.json({ error: 'Konflikt wersji' }, { status: 409 });
      const saved = { category, templates: body.templates, revision: current.revision + 1 };
      if (category === 'emails') database = saved;
      else reviews = saved;
    }
    return Response.json(category === 'emails' ? database : reviews);
  }));
});
afterEach(() => { cleanup(); localStorage.clear(); });

it('allows copying and editing a collapsed template', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const view = render(<ReplyTemplates />);
  const title = DEFAULT_REPLY_TEMPLATES[1].title;
  fireEvent.click(await view.findByRole('button', { name: `Kopiuj wzorzec: ${title}` }));
  expect(writeText).toHaveBeenCalledExactlyOnceWith(DEFAULT_REPLY_TEMPLATES[1].content);
  expect(view.getByRole('button', { name: title }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(view.getByRole('button', { name: `Edytuj wzorzec: ${title}` }));
  expect((view.getByLabelText('Nazwa') as HTMLInputElement).value).toBe(title);
  expect(view.queryByRole('button', { name: 'Wstaw do czatu' })).toBeNull();
});

it('persists adds, edits and deletions through the API', async () => {
  const view = render(<ReplyTemplates />);
  await view.findByRole('button', { name: DEFAULT_REPLY_TEMPLATES[0].title });
  fireEvent.click(view.getByRole('button', { name: 'Dodaj wzorzec' }));
  fireEvent.change(view.getByLabelText('Nazwa'), { target: { value: 'Testowy wzorzec' } });
  fireEvent.change(view.getByLabelText('Treść odpowiedzi'), { target: { value: 'Testowa treść' } });
  fireEvent.click(view.getByRole('button', { name: 'Zapisz wzorzec' }));
  fireEvent.click(await view.findByRole('button', { name: 'Edytuj wzorzec: Testowy wzorzec' }));
  expect(database.templates.at(-1)?.content).toBe('Testowa treść');
  fireEvent.change(view.getByLabelText('Treść odpowiedzi'), { target: { value: 'Zmieniona treść' } });
  fireEvent.click(view.getByRole('button', { name: 'Zapisz wzorzec' }));
  await waitFor(() => expect(view.queryByLabelText('Nazwa')).toBeNull());
  fireEvent.click(view.getByRole('button', { name: 'Usuń wzorzec: Testowy wzorzec' }));
  expect(database.templates).toHaveLength(4);
  fireEvent.click(view.getByRole('button', { name: /^Usuń$/ }));
  await waitFor(() => expect(database.templates).toHaveLength(3));
});

it('keeps a draft on failed save and does not claim it was saved', async () => {
  const view = render(<ReplyTemplates />);
  fireEvent.click(await view.findByRole('button', { name: `Edytuj wzorzec: ${DEFAULT_REPLY_TEMPLATES[0].title}` }));
  fireEvent.change(view.getByLabelText('Treść odpowiedzi'), { target: { value: 'Niezapisany tekst' } });
  failSave = true;
  fireEvent.click(view.getByRole('button', { name: 'Zapisz wzorzec' }));
  await view.findByRole('alert');
  expect((view.getByLabelText('Treść odpowiedzi') as HTMLTextAreaElement).value).toBe('Niezapisany tekst');
  expect(database.revision).toBe(1);
});

it('imports modified local defaults as separate entries without overwriting cloud data', async () => {
  const local = JSON.stringify([{ ...DEFAULT_REPLY_TEMPLATES[0], content: 'Własna odpowiedź' }]);
  localStorage.setItem(key, local);
  const view = render(<ReplyTemplates />);
  await view.findByRole('button', { name: DEFAULT_REPLY_TEMPLATES[0].title });
  fireEvent.click(await view.findByRole('button', { name: /Importuj wzorce/ }));
  await waitFor(() => expect(database.templates).toHaveLength(4));
  expect(database.templates[0]).toEqual(DEFAULT_REPLY_TEMPLATES[0]);
  expect(database.templates[3].content).toBe('Własna odpowiedź');
  expect(database.templates[3].id).not.toBe('quote-pl');
  expect(localStorage.getItem(key)).toBe(local);
});

it('preserves unreadable local data while loading cloud templates', async () => {
  localStorage.setItem(key, 'broken');
  const view = render(<ReplyTemplates />);
  expect((await view.findByRole('alert')).textContent).toContain('Nie można odczytać lokalnych');
  await view.findByRole('button', { name: DEFAULT_REPLY_TEMPLATES[0].title });
  expect(localStorage.getItem(key)).toBe('broken');
});


it('keeps templates, search and saves separate between tabs', async () => {
  const view = render(<ReplyTemplates />);
  await view.findByRole('button', { name: DEFAULT_REPLY_TEMPLATES[0].title });
  fireEvent.change(view.getByLabelText('Szukaj wzorca'), { target: { value: 'wyceną' } });
  fireEvent.mouseDown(view.getByRole('tab', { name: 'Opinie Google' }), { button: 0, ctrlKey: false });
  await view.findByText(/Dodaj pierwszy wzorzec w zakładce „Opinie Google”/);
  expect(view.queryByRole('button', { name: DEFAULT_REPLY_TEMPLATES[0].title })).toBeNull();
  expect((view.getByLabelText('Szukaj wzorca') as HTMLInputElement).value).toBe('');
  fireEvent.click(view.getByRole('button', { name: 'Dodaj wzorzec' }));
  expect((view.getByRole('tab', { name: 'Emaile' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(view.getByLabelText('Nazwa'), { target: { value: 'Podziękowanie za opinię' } });
  fireEvent.change(view.getByLabelText('Treść odpowiedzi'), { target: { value: 'Dziękujemy za opinię!' } });
  fireEvent.click(view.getByRole('button', { name: 'Zapisz wzorzec' }));
  await view.findByRole('button', { name: 'Podziękowanie za opinię' });
  expect(reviews.templates[0].content).toBe('Dziękujemy za opinię!');
  expect(database.templates).toEqual(DEFAULT_REPLY_TEMPLATES);
  expect(database.revision).toBe(1);
  fireEvent.mouseDown(view.getByRole('tab', { name: 'Emaile' }), { button: 0, ctrlKey: false });
  await view.findByRole('button', { name: DEFAULT_REPLY_TEMPLATES[0].title });
  expect(view.queryByRole('button', { name: 'Podziękowanie za opinię' })).toBeNull();
  fireEvent.mouseDown(view.getByRole('tab', { name: 'Opinie Google' }), { button: 0, ctrlKey: false });
  await view.findByRole('button', { name: 'Podziękowanie za opinię' });
});

it('offers legacy browser imports only in emails', async () => {
  localStorage.setItem(key, JSON.stringify([{ id: 'local', title: 'Lokalny email', content: 'Treść emaila' }]));
  const view = render(<ReplyTemplates />);
  await view.findByRole('button', { name: DEFAULT_REPLY_TEMPLATES[0].title });
  await view.findByRole('button', { name: /Importuj wzorce/ });
  fireEvent.mouseDown(view.getByRole('tab', { name: 'Opinie Google' }), { button: 0, ctrlKey: false });
  await view.findByText(/Dodaj pierwszy wzorzec w zakładce „Opinie Google”/);
  expect(view.queryByRole('button', { name: /Importuj wzorce/ })).toBeNull();
});
