import { configurationStamp } from '../central/schema.mjs';
import { decide } from '../ai/jev-client.js';
import { triageQuestions, catalogQuestions, orderQuestions, field } from '../ai/questions.js';
import { validateCatalog, EMPTY_CATALOG } from '../catalog/catalog.js';
import { priceOrder, visitDuration } from '../tools/pricing.js';
import { renderCase } from '../templates/render.js';

export function fingerprint(thread) {
  // Full canonical snapshot rather than a lossy/non-cryptographic hash.
  return JSON.stringify([thread.threadId || '', thread.ostatniaWiadomoscId || '', thread.tytul || '',
    (thread.wiadomosci || []).map(m => [m.id, m.nadawca, m.tekst])]);
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function cleanText(text, secrets) {
  let value = String(text || '');
  for (const s of secrets.filter(Boolean)) value = value.split(s).join('[sekret]');
  return value.replace(/https?:\/\/\S+/g, '[link]').replace(/[\w.+-]+@[\w.-]+\.[\w-]+/g, '[email]')
    .replace(/(?:\+?\d[ -]?){9,}/g, '[telefon]');
}
export async function analyzeThread({ thread, settings, signal, decideImpl = decide }) {
  const catalog = validateCatalog(settings.jev.catalog || EMPTY_CATALOG);
  const threshold = settings.jev.threshold;
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) throw new Error('Nieprawidłowy próg pewności.');
  const now = new Date();
  const state = { today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(now), timezone: 'Europe/Warsaw',
    subject: cleanText(thread.tytul, [settings.apiKey, settings.icalUrl]),
    messages: (thread.wiadomosci || []).map((m, i) => ({ index: i + 1,
      // Do not pretend to know message timestamps/roles the Gmail adapter cannot read.
      author: cleanText(m.nadawca, [settings.apiKey, settings.icalUrl]),
      text: cleanText(m.tekst, [settings.apiKey, settings.icalUrl]) })),
    catalog: catalog.items.map(({ id, name, aliases, unit }) => ({ id, name, aliases, unit })) };
  if (!state.messages.length || !state.messages.some(m => m.text.trim())) throw new Error('Brak treści wiadomości.');
  const metrics = [];
  const deadline = Date.now() + 45000;
  const ask = async questions => {
    if (signal?.aborted) throw new Error('Anulowano analizę.');
    if (Date.now() >= deadline) throw new Error('Przekroczono budżet 45 s analizy Jev.');
    const r = await decideImpl({ timeoutMs: Math.min(20000, deadline-Date.now()), apiKey: settings.apiKey, model: settings.jev.model, state, questions, signal });
    metrics.push(r.metrics); return r.answers;
  };
  const raw = await ask({ ...triageQuestions(now.getFullYear()), ...catalogQuestions(catalog) });
  const fields = Object.fromEntries(Object.entries(raw).map(([id, a]) => [id, { ...field(a, threshold), questionId: id }]));
  const get = k => fields[k]?.value;
  const issues = [...(thread.ostrzezenia || [])];
  const intents = { quote: get('quote') === 'yes', availability: get('availability') === 'yes' };
  if (get('review') !== 'no') issues.push('Sprawa wymaga decyzji człowieka.');
  if (!get('quote') || !get('availability')) issues.push('Niepewny triaż.');
  const language = get('language');
  if (!['pl', 'en'].includes(language)) issues.push('Język wymaga ręcznej odpowiedzi.');
  const people = /^\d+$/.test(get('people') || '') ? Number(get('people')) : null;
  const date = ['year','month','day'].every(k => get(k) && /^\d+$/.test(get(k)))
    ? `${get('year')}-${get('month').padStart(2,'0')}-${get('day').padStart(2,'0')}` : null;
  const billingPeople = /^\d+$/.test(get('billingPeople') || '') ? Number(get('billingPeople')) : people;
  const order = { people, billingPeople, date: validDate(date) ? date : null, time: /^\d\d:\d\d$/.test(get('time') || '') ? get('time') : null,
    durationMin: /^\d+$/.test(get('duration') || '') ? Number(get('duration')) : null, durationSource: 'message', participants: [] };
  if (order.date && order.date < state.today) { order.date = null; issues.push('Termin znajduje się w przeszłości.'); }
  if (get('unsupported') !== 'no' && intents.quote) issues.push('Niejasne zamówienie lub pozycje poza katalogiem.');
  const selected = catalog.items.filter(item => get(`product_${item.id}`) === 'yes');
  if (catalog.items.some(item => get(`product_${item.id}`) !== 'no' && get(`product_${item.id}`) !== 'yes')) issues.push('Niepewne dopasowanie produktów katalogu.');
  if (billingPeople && selected.length && (intents.quote || intents.availability)) {
    const questions = orderQuestions(billingPeople, { ...catalog, items: selected });
    // Split only when size requires it; no truncation of a participant or order.
    const batches = []; let batch = {};
    for (const [id, q] of Object.entries(questions)) {
      if (Object.keys(batch).length && (Object.keys(batch).length >= 100 || JSON.stringify({state,questions:{...batch,[id]:q}}).length > 60000)) {
        batches.push(batch); batch = {};
      }
      batch[id] = q;
    }
    if (Object.keys(batch).length) batches.push(batch);
    if (batches.length > 7) issues.push('Zamówienie przekracza budżet 8 wywołań Jev. Uzupełnij ręcznie.');
    else {
      let answers = {};
      for (const b of batches) answers = { ...answers, ...await ask(b) };
      for (let p = 1; p <= billingPeople; p++) {
        const participant = { id: p, complete: field(answers[`p${p}_complete`], threshold).value === 'yes', items: [] };
        for (const item of selected) {
          const id = `p${p}_${item.id}`;
          const f = field(answers[id], threshold); fields[id] = { ...f, questionId: id };
          if (f.value === 'none') continue;
          if (/^\d+$/.test(f.value || '')) participant.items.push({ itemId: item.id, quantity: Number(f.value) });
          else participant.complete = false;
        }
        order.participants.push(participant);
      }
    }
  }
  return { schemaVersion: 1, runId: crypto.randomUUID(), threadId: thread.threadId || null,
    lastMessageId: thread.ostatniaWiadomoscId || null, snapshot: fingerprint(thread), analyzedAt: now.toISOString(),
    intents, language, order, fields, issues, metrics, catalogVersion: catalog.version };
}
export async function calculateCase(c, settings, availability) {
  if (c?.schemaVersion !== 1) throw new Error('Nieobsługiwana wersja analizy. Przeanalizuj mail ponownie.');
  const result = structuredClone(c);
  result.configurationStamp = configurationStamp(settings);
  result.missing = [];
  const catalog = validateCatalog(settings.jev.catalog);
  const order = result.order;
  if (!order || typeof order !== 'object' || !Array.isArray(order.participants) || order.participants.length > 30 ||
    order.participants.some(p => !p || !Array.isArray(p.items) || p.items.length > 100 || p.items.some(e => !e || typeof e.itemId !== 'string')))
    throw new Error('Nieprawidłowe dane zamówienia.');
  if (!Array.isArray(result.issues) || !Array.isArray(result.metrics) || !result.intents || !result.fields) throw new Error('Nieprawidłowa sprawa.');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
  if (order.date && (!validDate(order.date) || order.date < today)) order.date = null;
  result.quote = result.intents.quote ? priceOrder(order, catalog) : null;
  if (result.intents.availability && (!Number.isInteger(order.people) || order.people < 1 || order.people > 30)) result.missing.push('people');
  if (result.intents.quote && !['complete','invalid'].includes(result.quote.status)) result.missing.push('order');
  if (order.durationSource === 'catalog') order.durationMin = null;
  if (!order.durationMin) { order.durationMin = visitDuration(order, catalog); if (order.durationMin) order.durationSource = 'catalog'; }
  result.availability = null;
  if (result.intents.availability) {
    if (!validDate(order.date)) result.missing.push('date');
    if (!Number.isInteger(order.durationMin) || order.durationMin < 1 || order.durationMin > 480) result.missing.push('duration');
    if (order.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(order.time)) result.missing.push('time');
    if (result.fields.time?.status === 'ambiguous' || result.fields.time?.status === 'other') result.missing.push('time');
    if (!result.missing.some(k => ['people','date','duration','time'].includes(k))) {
      const start = Date.now();
      try {
        const r = await availability({ dataISO: order.date, osoby: order.people, czasTrwaniaMin: order.durationMin, preferowanaGodzina: order.time });
        if (!r || !Array.isArray(r.proponowane) || !r.zrodlo || r.proponowane.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('Niepełny wynik kalendarza.');
        // Existing DOM adapter lacks completeness evidence. Never upgrade it to confirmed.
        result.availability = { status: 'provisional', times: r.proponowane, source: r.zrodlo, observedAt: new Date().toISOString() };
      } catch (e) { result.availability = { status: 'unavailable', error: e.message, times: [] }; }
      result.metrics.push({ tool: 'availability', ms: Date.now() - start });
    }
  }
  result.needsReview = result.issues.length > 0 || result.missing.includes('duration') ||
    (result.intents.quote && (!catalog.approved || !catalog.items.length)) || !['pl','en'].includes(result.language);
  result.draft = !result.needsReview && (result.intents.quote || result.intents.availability)
    ? renderCase(result, settings.jev.templates) : null;
  return result;
}
