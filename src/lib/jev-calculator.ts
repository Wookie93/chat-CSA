import 'server-only';
import { analyzeThread, calculateCase } from '../../extensions/JevCSAssistant/core/orchestrator.js';
import { zUstawieniami } from '../../extensions/JevCSAssistant/config.js';
import { validateConfiguration } from '../../extensions/JevCSAssistant/central/schema.mjs';
import { getServerClient } from '@/lib/supabase';
import type { ChatMessage } from '@/lib/schemas';
import { RequestError } from '@/lib/request-limits';
import { chatRecognitionCatalog, recognizeChatOrderList } from '@/lib/jev-recognition';
import { applyDefaultShotQuantities, defaultShotQuantity } from '@/lib/jev-default-quantities';
import { renderCase } from '../../extensions/JevCSAssistant/templates/render.js';

export async function calculateWithJev(messages: ChatMessage[], apiKey: string, signal: AbortSignal) {
  const { data, error } = await getServerClient().from('shared_configuration')
    .select('document').order('revision', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new RequestError('Nie udało się odczytać katalogu kalkulatora. Spróbuj ponownie.', 503);
  let configuration;
  try {
    configuration = data ? validateConfiguration(data.document) : null;
  } catch {
    throw new RequestError('Opublikowana konfiguracja Jev jest nieprawidłowa. Wymaga naprawy w Supabase; wycena została zatrzymana.', 503);
  }
  const settings = zUstawieniami({ apiKey, ...(configuration ? { jev: {
    catalog: configuration.catalog, templates: configuration.templates,
    availabilityPolicy: configuration.availabilityPolicy,
  } } : {}) });
  settings.jev.catalog = chatRecognitionCatalog(settings.jev.catalog);
  const parsedList = messages.length === 1 && messages[0].role === 'user'
    ? recognizeChatOrderList(messages[0].content, settings.jev.catalog) : null;
  const directList = parsedList?.entries.every(entry => entry.quantity !== null || defaultShotQuantity(entry.item))
    ? parsedList : null;
  const explicitList = directList?.entries.map(entry => ({ ...entry,
    quantity: entry.quantity ?? defaultShotQuantity(entry.item)! }));
  const analysis = explicitList ? {
    schemaVersion: 1, intents: { quote: true, availability: false }, language: directList?.language ?? 'pl',
    order: { people: null, billingPeople: 1, date: null, time: null, durationMin: null,
      durationSource: 'message', participants: [{ id: 1, complete: true,
        items: explicitList.map(({ item, quantity }) => ({ itemId: item.id, quantity })) }] },
    matches: explicitList.map(({ item }) => ({ itemId: item.id, name: item.name, status: 'matched',
      sourceMessage: 1, sourceText: messages[0].content })),
    fields: {}, issues: [], metrics: [], catalogVersion: settings.jev.catalog.version,
  } : await analyzeThread({
    thread: { wiadomosci: messages.map(message => ({
      nadawca: message.role === 'user' ? 'Klient' : 'Obsługa — poprzednia odpowiedź, nie nowe zamówienie',
      tekst: message.content,
    })), ostrzezenia: [] }, settings, signal,
  });
  const defaults = directList
    ? directList.entries.filter(entry => entry.quantity === null)
      .map(({ item }) => ({ personId: 1, name: item.name, quantity: defaultShotQuantity(item)! }))
    : applyDefaultShotQuantities(analysis, settings.jev.catalog);
  const priceNote = directList?.entries.some(entry => entry.quotedPrice !== null)
    ? 'Ceny podane w wiadomości pominięto; wycenę obliczono według cennika.' : '';
  const defaultNote = defaults.length ? `Przyjęto domyślne liczby strzałów z cennika: ${defaults.map(item => `${item.name} — ${item.quantity} (osoba/zestaw ${item.personId})`).join(', ')}.` : '';
  const result = await calculateCase(analysis, settings, async () => {
    throw new Error('Kalendarz nie jest połączony z aplikacją WWW.');
  });
  const names = analysis.matches.filter((match: { status: string }) => match.status === 'matched')
    .map((match: { name: string | null }) => match.name).join(', ');
  if (result.draft?.text) {
    const draft = renderCase(result, settings.jev.templates, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return [defaultNote, priceNote, draft.text].filter(Boolean).join('\n\n');
  }
  if (!analysis.intents.quote && !analysis.intents.availability) {
    return 'Tryb Jev służy do rozpoznawania zamówień i wyceny. Podaj bronie lub pakiety, liczbę strzałów i podział na osoby. Do swobodnej rozmowy wybierz tryb LLM w ustawieniach.';
  }
  const pricingIssues: string[] = result.quote?.issues ?? [];
  const catalogBlocked = pricingIssues.includes('zatwierdzony cennik');
  const orderBlocked = result.missing.includes('order') && (!catalogBlocked || pricingIssues.some(issue => issue !== 'zatwierdzony cennik'));
  return [names ? `Rozpoznane produkty: ${names}.` : 'Nie udało się jednoznacznie rozpoznać zamówienia.',
    defaultNote,
    priceNote,
    'Zamówienie wymaga sprawdzenia przed podaniem pełnej wyceny.',
    ...result.issues,
    catalogBlocked ? 'Cennik Jev nie jest zatwierdzony lub jest pusty. Administrator musi sprawdzić i zatwierdzić katalog, zanim kalkulator poda cenę.' : '',
    orderBlocked ? (names ? 'Uzupełnij ilości przy rozpoznanych produktach i przypisanie do osób.' : 'Podaj bronie lub pakiety i ilości dla każdej osoby.') : '',
    analysis.intents.availability ? 'Dostępność terminu wymaga sprawdzenia w kalendarzu.' : '',
  ].filter(Boolean).join('\n\n');
}
