'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Accordion, Tabs } from 'radix-ui';
import { BookOpenText, ChevronDown, Copy, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DEFAULT_REPLY_TEMPLATES, REPLY_TEMPLATE_CATEGORIES, replyLibrarySchema, replyTemplateCategorySchema, replyTemplatesSchema, type ReplyLibrary, type ReplyTemplate, type ReplyTemplateCategory } from '@/lib/reply-templates';

const STORAGE_KEY = 'chat.reply-templates.v1';
const IMPORT_KEY = 'chat.reply-templates.imported.v1';

export function ReplyTemplates() {
  const [category, setCategory] = useState<ReplyTemplateCategory>('emails');
  const [library, setLibrary] = useState<ReplyLibrary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const requestVersion = useRef(0);
  const [localTemplates, setLocalTemplates] = useState<ReplyTemplate[]>([]);
  const [localError, setLocalError] = useState('');
  const corrupted = library === null || library.category !== category;
  const templates = !corrupted ? library.templates : [];

  const reload = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    try {
      const response = await fetch(`/api/reply-templates?category=${category}`, { cache: 'no-store', signal });
      if (!response.ok) throw new Error('Nie udało się pobrać biblioteki z Supabase.');
      const data = replyLibrarySchema.parse(await response.json());
      if (data.category !== category) throw new Error('Nieprawidłowa kategoria biblioteki.');
      if (!signal?.aborted && version === requestVersion.current) { setLibrary(data); setError(''); }
    } catch {
      if (!signal?.aborted && version === requestVersion.current) setError('Nie udało się pobrać biblioteki z Supabase. Spróbuj ponownie.');
    }
  }, [category]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    const controller = new AbortController();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && localStorage.getItem(IMPORT_KEY) !== saved) {
        const parsed = replyTemplatesSchema.parse(JSON.parse(saved));
        const custom = parsed.filter((item) => !DEFAULT_REPLY_TEMPLATES.some((original) => original.title === item.title && original.content === item.content));
        // Reading browser-only data after mount avoids hydration differences.
        queueMicrotask(() => { if (!controller.signal.aborted) setLocalTemplates(custom); });
      }
    } catch {
      queueMicrotask(() => { if (!controller.signal.aborted) setLocalError('Nie można odczytać lokalnych wzorców. Dane w przeglądarce pozostają nienaruszone.'); });
    }
    return () => controller.abort();
  }, []);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState('quote-pl');
  const [editor, setEditor] = useState<ReplyTemplate | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = templates.filter((template) =>
    `${template.title} ${template.content}`.toLocaleLowerCase('pl').includes(query.trim().toLocaleLowerCase('pl')),
  );

  async function saveTemplates(next: ReplyTemplate[]) {
    if (!library || corrupted || lock.current) return false;
    lock.current = true;
    ++requestVersion.current;
    setBusy(true);
    try {
      const response = await fetch('/api/reply-templates', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, templates: next, revision: library.revision }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Nie udało się zapisać wzorców.');
      const saved = replyLibrarySchema.parse(body);
      if (saved.category !== category) throw new Error('Nieprawidłowa kategoria biblioteki.');
      setLibrary(saved);
      setError('');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nie udało się zapisać wzorców.';
      setError(message);
      toast.error(message);
      return false;
    } finally { lock.current = false; setBusy(false); }
  }

  async function saveEditor(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const updated = { ...editor, title: editor.title.trim(), content: editor.content.trim() };
    if (!updated.title || !updated.content) return;
    if (!isNew && !templates.some(({ id }) => id === updated.id)) {
      toast.error('Ten wzorzec został usunięty. Skopiuj treść i dodaj nowy wzorzec.');
      return;
    }
    const next = isNew ? [...templates, updated] : templates.map((template) => template.id === updated.id ? updated : template);
    if (await saveTemplates(next)) {
      setEditor(null);
      setOpenId(updated.id);
      setQuery('');
      toast.success('Wzorzec zapisany w Supabase.');
    }
  }

  async function importLocal() {
    const additions = localTemplates.filter((local) => !templates.some((item) => item.title === local.title && item.content === local.content))
      .map((item) => ({ ...item, id: crypto.randomUUID() }));
    if (templates.length + additions.length > 100) { toast.error('Import przekroczyłby limit 100 wzorców.'); return; }
    if (additions.length && !await saveTemplates([...templates, ...additions])) return;
    setLocalTemplates([]);
    try { localStorage.setItem(IMPORT_KEY, localStorage.getItem(STORAGE_KEY) ?? ''); } catch { /* Original browser data remains intact. */ }
    toast.success('Lokalne wzorce są dostępne w Supabase.');
  }

  async function copyTemplate(content: string) {
    try { await navigator.clipboard.writeText(content); toast.success('Wzorzec skopiowany.'); }
    catch { toast.error('Nie udało się skopiować wzorca.'); }
  }

  return (
    <aside aria-labelledby="reply-templates-heading" className="flex min-h-0 min-w-0 flex-col border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2">
        <h2 id="reply-templates-heading" className="flex min-w-0 items-center gap-2 text-lg font-medium">
          <BookOpenText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Wzorce odpowiedzi
        </h2>
        <div className="flex items-center">
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Odśwież bibliotekę" disabled={busy} onClick={() => void reload()}><RefreshCw className="size-4" /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Dodaj wzorzec"
          disabled={corrupted || busy || templates.length >= 100 || editor !== null}
          onClick={() => { setEditor({ id: crypto.randomUUID(), title: '', content: '' }); setIsNew(true); }}>
          <Plus className="size-4" />
        </Button>
        </div>
      </div>
      <p className="mt-1 mb-4 text-xs text-muted-foreground">Gotowe treści pod ręką. Rozwiń, skopiuj lub edytuj.</p>
      <Tabs.Root value={category} onValueChange={(value) => {
        setCategory(replyTemplateCategorySchema.parse(value));
        setQuery('');
        setOpenId('');
        setDeleteId(null);
        setError('');
      }} className="flex min-h-0 flex-1 flex-col">
      <Tabs.List aria-label="Kategorie wzorców" className="mb-3 grid shrink-0 grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {REPLY_TEMPLATE_CATEGORIES.map((item) => (
          <Tabs.Trigger key={item.value} value={item.value} disabled={busy || editor !== null}
            className="min-h-11 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
            {item.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content key={category} value={category} className="flex min-h-0 flex-1 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="relative mb-3 shrink-0">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Szukaj wzorca" placeholder="Szukaj wzorca…" value={query}
          onChange={(event) => setQuery(event.target.value)} className="pl-9" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {error && <p role="alert" className="mb-3 rounded-lg border p-3 text-sm text-destructive">{error}</p>}
        {localError && <p role="alert" className="mb-3 text-xs text-destructive">{localError}</p>}
        {category === 'emails' && localTemplates.length > 0 && <Button type="button" variant="secondary" size="sm" className="mb-3 h-auto whitespace-normal" disabled={busy || corrupted || editor !== null} onClick={() => void importLocal()}>Importuj wzorce z przeglądarki ({localTemplates.length})</Button>}
        {editor && (
          <form onSubmit={saveEditor} className="mb-3 space-y-3 rounded-xl border bg-muted/30 p-3">
            <h3 className="text-sm font-medium">{isNew ? 'Nowy wzorzec' : 'Edytuj wzorzec'}</h3>
            <div className="space-y-1.5">
              <label htmlFor="template-title" className="text-xs font-medium">Nazwa</label>
              <Input id="template-title" disabled={busy} autoFocus maxLength={100} required value={editor.title}
                onChange={(event) => setEditor({ ...editor, title: event.target.value })} placeholder="Np. Odpowiedź na zapytanie" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="template-content" className="text-xs font-medium">Treść odpowiedzi</label>
              <Textarea id="template-content" disabled={busy} maxLength={16000} required value={editor.content}
                onChange={(event) => setEditor({ ...editor, content: event.target.value })}
                className="max-h-80 min-h-40 resize-y [field-sizing:fixed]" />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditor(null)}>Anuluj</Button>
              <Button type="submit" size="sm" disabled={busy || !editor.title.trim() || !editor.content.trim()}>Zapisz wzorzec</Button>
            </div>
          </form>
        )}
        {corrupted ? (
          <p role="status" className="p-4 text-sm text-muted-foreground">{error ? 'Biblioteka jest niedostępna. Użyj przycisku odświeżania.' : 'Ładowanie wzorców…'}</p>
        ) : (
          <Accordion.Root type="single" collapsible value={openId} onValueChange={setOpenId} className="space-y-2">
            {filtered.map((template) => (
              <Accordion.Item key={template.id} value={template.id} className="overflow-hidden rounded-xl border bg-background">
                <div className="relative flex items-center gap-1 pr-10">
                <Accordion.Header className="min-w-0 flex-1">
                  <Accordion.Trigger className="group flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{template.title}</span>
                    <ChevronDown className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
                  </Accordion.Trigger>
                </Accordion.Header>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Kopiuj wzorzec: ${template.title}`} onClick={() => void copyTemplate(template.content)}><Copy /></Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Edytuj wzorzec: ${template.title}`} disabled={busy || editor !== null}
                  onClick={() => { setEditor({ ...template }); setIsNew(false); }}><Pencil /></Button>
                </div>
                <Accordion.Content className="border-t px-4 pb-3 pt-3">
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{template.content}</p>
                  {template.content.includes('{{') && <p className="mt-3 text-xs text-muted-foreground">Uzupełnij pola w podwójnych klamrach przed wysłaniem.</p>}
                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    <Button type="button" size="icon-sm" variant="ghost" className="ml-auto text-muted-foreground" aria-label={`Usuń wzorzec: ${template.title}`}
                      disabled={busy} onClick={() => setDeleteId(template.id)}><Trash2 /></Button>
                  </div>
                  {deleteId === template.id && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
                      <span>Usunąć ten wzorzec?</span>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDeleteId(null)}>Anuluj</Button>
                      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={async () => {
                        if (await saveTemplates(templates.filter(({ id }) => id !== template.id))) {
                          setDeleteId(null);
                          if (editor?.id === template.id) setEditor(null);
                        }
                      }}>Usuń</Button>
                    </div>
                  )}
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        )}
        {!corrupted && filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{query.trim() ? 'Brak wzorców pasujących do wyszukiwania.' : `Dodaj pierwszy wzorzec w zakładce „${REPLY_TEMPLATE_CATEGORIES.find((item) => item.value === category)?.label}” przyciskiem +.`}</p>}
      </div>
      </Tabs.Content>
      </Tabs.Root>
      <p className="shrink-0 pt-3 text-xs text-muted-foreground">{busy ? 'Zapisywanie…' : 'Wspólna biblioteka · Supabase'} · {templates.length} / 100</p>
    </aside>
  );
}
