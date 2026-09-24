// Test integracyjny background.js na atrapach chrome.* i fetch.
// Sprawdza routing wiadomości, pipeline dostępności i pełny cykl semi-auto z deduplikacją.
import test from 'node:test';
import assert from 'node:assert/strict';

const ICAL = [
  'BEGIN:VCALENDAR',
  // Obsada instruktorów na ten dzień — wydarzenie o czysto numerycznym tytule (spec 1.0, 5.3).
  // Bez niego kalendarz znaczy „zero obsady" i nic nie jest dostępne.
  'BEGIN:VEVENT', 'UID:obsada', 'DTSTART;TZID=Europe/Warsaw:20260518T110000',
  'DTEND;TZID=Europe/Warsaw:20260518T183000', 'SUMMARY:2', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a', 'DTSTART;TZID=Europe/Warsaw:20260518T120000',
  'DTEND;TZID=Europe/Warsaw:20260518T133000', 'SUMMARY:Rezerwacja 4os', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const stan = { magazyn: {}, alarmy: {}, karty: [], kartyKalendarza: [], nawigacje: [], chipy: null, doKarty: [], zapytaniaAI: 0, podtrzyman: 0 };
let onMessage;
let bg;            // przestrzeń nazw background.js — testy skracają przez nią LIMITY
let limityDomyslne;

function stubChrome() {
  const listeners = { msg: [], alarm: [], storage: [], installed: [], startup: [] };
  globalThis.chrome = {
    storage: {
      local: {
        async get(klucz) {
          if (klucz === null || klucz === undefined) return { ...stan.magazyn };
          const klucze = Array.isArray(klucz) ? klucz : [klucz];
          return Object.fromEntries(klucze.filter((k) => k in stan.magazyn).map((k) => [k, stan.magazyn[k]]));
        },
        async set(obj) {
          // Atrapa limitu chrome.storage.local (QUOTA_BYTES): tak samo jak Chrome rzuca wyjątkiem.
          if (stan.limitBajtow && JSON.stringify(obj).length > stan.limitBajtow) {
            throw new Error('Resource::kQuotaBytes quota exceeded');
          }
          Object.assign(stan.magazyn, obj);
          for (const fn of listeners.storage) fn(Object.fromEntries(Object.keys(obj).map((k) => [k, {}])), 'local');
        },
        async remove(klucz) {
          for (const k of Array.isArray(klucz) ? klucz : [klucz]) delete stan.magazyn[k];
        },
      },
      onChanged: { addListener: (fn) => listeners.storage.push(fn) },
    },
    alarms: {
      async clear(n) { delete stan.alarmy[n]; },
      async create(n, o) { stan.alarmy[n] = o; },
      async get(n) { return stan.alarmy[n] || null; },
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
    runtime: {
      onMessage: { addListener: (fn) => listeners.msg.push(fn) },
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      // Woła je `podtrzymajWorkera`, żeby resetować 30-sekundowy licznik bezczynności.
      getPlatformInfo: async () => { stan.podtrzyman++; return { os: 'linux' }; },
    },
    sidePanel: { setPanelBehavior: async () => {} },
    tabs: {
      async create(opcje) {
        const t = { id: (stan.nextTabId = (stan.nextTabId || 0) + 1), ...opcje };
        if (String(opcje?.url || '').includes('calendar.google.com')) stan.calendarCreates = (stan.calendarCreates || 0) + 1;
        stan.karty.push(t);
        if (String(opcje?.url || '').includes('calendar.google.com')) stan.urlKalendarza = opcje.url;
        return t;
      },
      async remove(id) { stan.karty = stan.karty.filter((t) => t.id !== id); },
      async query(zapytanie) {
        if (String(zapytanie?.url || '').includes('calendar.google.com')) return stan.kartyKalendarza || [];
        return stan.karty;
      },
      async update(id, opcje) {
        stan.nawigacje.push({ id, ...opcje });
        if (String(opcje?.url || '').includes('calendar.google.com')) stan.urlKalendarza = opcje.url;
        return { id, ...opcje };
      },
      async sendMessage(_id, msg) {
        stan.doKarty.push(msg.typ);
        switch (msg.typ) {
          case 'PING': return { ok: true, gotowy: true };
          case 'SKANUJ_LISTE': return { ok: true, watki: [{ threadId: 'T1', temat: 'Termin 18.05 dla 4 osób' }] };
          case 'OTWORZ_WATEK': return { ok: true, dane: {
            threadId: 'T1', tytul: 'Termin 18.05 dla 4 osób', wiadomosci: [{ id: 'M1', nadawca: 'k@x.pl', tekst: 'Dzień dobry, czy 18.05 o 14:00 jest wolne dla 4 osób?' }],
            ostatniaWiadomoscId: 'M1', ostrzezenia: [] } };
          case 'WSTRZYKNIJ_DRAFT': stan.ostatniDraft = msg; return { ok: true };
          case 'WROC_DO_LISTY': return { ok: true };
          default: return { ok: false };
        }
      },
    },
    scripting: {
      // Odwzorowuje `zbierzChipyZeStrony`: chipy PLUS ścieżka karty, na której siedzimy.
      async executeScript() {
        if (!stan.chipy) throw new Error('brak dostępu do karty');
        const sciezka = stan.sciezkaKalendarza
          ?? new URL(stan.urlKalendarza || 'https://calendar.google.com/calendar/u/0/r').pathname;
        return [{ result: { sciezka, chipy: stan.chipy } }];
      },
    },
  };
  return listeners;
}

/**
 * Odpowiedź iCal jako strumień. Tniemy na 7-bajtowe kawałki, żeby granice fragmentów
 * wypadały w środku linii i w środku składania (RFC 5545) — inaczej test nie sprawdziłby
 * niczego, czego nie sprawdza zwykłe `text()`.
 */
export function odpowiedzICal(tekst, { rozmiarFragmentu = 7 } = {}) {
  const bajty = new TextEncoder().encode(tekst);
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (i >= bajty.length) return { done: true, value: undefined };
            const kawalek = bajty.slice(i, i + rozmiarFragmentu);
            i += rozmiarFragmentu;
            return { done: false, value: kawalek };
          },
        };
      },
    },
  };
}

function stubFetch() {
  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) {
      stan.zapytaniaAI++;
      const body = JSON.parse(opcje.body);
      stan.ostatniPrompt = body.messages;
      if (body.questions) {
        stan.ostatniePytania = body.questions;
        stan.ostatniStan = body.state;
        const values = { quote:'no', availability:'yes', review:'no', language:'pl', people:'4', billingPeople:'4', day:'18', month:'5', year:'missing', time:'14:00', duration:'30', unsupported:'no' };
        const answers = Object.fromEntries(Object.entries(body.questions).map(([id,q]) => [id, {
          type:'choice', choice:values[id], confidence:0.99,
          probabilities:Object.fromEntries(Object.keys(q.criteria).map(k => [k,k===values[id]?1:0]))
        }]));
        return { ok:true,status:200,json:async()=>({ answers, usage:{cost:0.0001} }) };
      }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Draft odpowiedzi.' } }], usage: {} }) };
    }
    return odpowiedzICal(ICAL);
  };
}

const wyslij = (msg) => new Promise((res) => onMessage(msg, {}, res));

test('przygotowanie środowiska', async () => {
  const listeners = stubChrome();
  stubFetch();
  stan.magazyn = {
    apiKey: 'test-key',
    jev: { shadow: false, availabilityPolicy:{staffing:'total',proposals:'nonOverlapping',allowFinishAfterClosing:false}, catalog: {version:'test',currency:'PLN',approved:false,items:[]} },
    icalUrl: 'https://calendar.google.com/calendar/ical/tajny/basic.ics',
    icalCacheSek: 0,
    semiauto: { wlaczony: false, interwalMin: 7, etykieta: '', zapytanieGmail: 'is:unread in:inbox', maxWatkowNaCykl: 3 },
  };
  bg = await import('../background.js');
  limityDomyslne = { ...bg.LIMITY };
  onMessage = listeners.msg[0];
  assert.ok(onMessage, 'background zarejestrował listener wiadomości');
});

test('DOSTEPNOSC: pipeline przez service worker', async () => {
  const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, preferowanaGodzina: '12:00' });
  assert.equal(odp.ok, true);
  assert.match(odp.wynik.tekst, /ZAJĘTE/);
  assert.equal(odp.wynik.sloty.find((s) => s.od === '13:30').dostepny, true);
});

test('ICAL_DIAGNOSTYKA zwraca raport', async () => {
  const odp = await wyslij({ typ: 'ICAL_DIAGNOSTYKA' });
  assert.equal(odp.ok, true);
  assert.equal(odp.raport.eventow, 2);   // rezerwacja + obsada
});

test('błąd braku klucza API jest czytelny', async () => {
  const klucz = stan.magazyn.apiKey;
  stan.magazyn.apiKey = '';
  const odp = await wyslij({ typ: 'AI', funkcja: 'pakiet', tresc: 'test' });
  assert.equal(odp.ok, false);
  assert.match(odp.blad, /klucz.*OpenRouter/);
  stan.magazyn.apiKey = klucz;
});

test('cykl semi-auto: draft + dane o dostępności w prompcie', async () => {
  const odp = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
  assert.equal(odp.ok, true);
  assert.equal(odp.draftow, 1, 'powstał jeden draft');
  assert.equal(odp.bledy.length, 0, `bez błędów: ${odp.bledy.join('; ')}`);
  assert.ok(stan.doKarty.includes('WSTRZYKNIJ_DRAFT'), 'draft trafił do karty');

  assert.ok(stan.ostatniePytania.availability);
  assert.match(stan.ostatniStan.messages[0].text, /18\.05/);
  assert.match(stan.ostatniDraft.tekst, /rokiem/, 'brak roku oznacza dopytanie, nie zgadywanie');
  assert.equal(stan.ostatniDraft.guarded, true);
  assert.ok(stan.ostatniDraft.expectedSnapshot.includes('M1'));
  assert.equal(stan.karty.length, 0, 'karta robocza została zamknięta');
});

test('deduplikacja: drugi cykl nie tworzy duplikatu draftu', async () => {
  const przed = stan.zapytaniaAI;
  const odp = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
  assert.equal(odp.draftow, 0);
  assert.equal(odp.pominieteDedup, 1);
  assert.equal(stan.zapytaniaAI, przed, 'model nie został wywołany ponownie');
});

test('nowa wiadomość w wątku przełamuje deduplikację', async () => {
  const oryginal = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (id, msg) => {
    if (msg.typ === 'OTWORZ_WATEK') {
      const w = await oryginal(id, msg);
      w.dane.wiadomosci.push({ id: 'M2', nadawca: 'k@x.pl', tekst: 'Ponawiam pytanie o 18.05.' });
      w.dane.ostatniaWiadomoscId = 'M2';
      return w;
    }
    return oryginal(id, msg);
  };
  const odp = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
  assert.equal(odp.draftow, 1);
  chrome.tabs.sendMessage = oryginal;
});

test('SEMIAUTO_STATUS raportuje stan', async () => {
  const odp = await wyslij({ typ: 'SEMIAUTO_STATUS' });
  assert.equal(odp.ok, true);
  assert.equal(odp.watkowWDedup, 1);
  assert.ok(odp.log.length > 0);
});

test('alarm ustawia się po włączeniu trybu', async () => {
  await chrome.storage.local.set({ semiauto: { ...stan.magazyn.semiauto, wlaczony: true, interwalMin: 12 } });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(stan.alarmy.semiauto.periodInMinutes, 10, 'interwał przycięty do widełek 5–10 min');
});

test('reset deduplikacji', async () => {
  await wyslij({ typ: 'SEMIAUTO_RESET_DEDUP' });
  const odp = await wyslij({ typ: 'SEMIAUTO_STATUS' });
  assert.equal(odp.watkowWDedup, 0);
});

/* ────────── Regresja: Resource::kQuotaBytes quota exceeded ────────── */

test('cache kalendarza nie trzyma surowego iCal i mieści się w quocie', async () => {
  delete stan.magazyn.icalEventy;
  stan.magazyn.icalCacheSek = 300;
  await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });

  const cache = stan.magazyn.icalEventy;
  assert.ok(cache, 'cache powstał');
  const zapisane = JSON.stringify(cache);
  assert.ok(!zapisane.includes('BEGIN:VCALENDAR'), 'surowy tekst iCal nie trafia do storage');
  assert.ok(zapisane.length < 100 * 1024, `wpis cache jest mały (${zapisane.length} B)`);
  assert.ok(cache.okno.od < cache.okno.do);
  stan.magazyn.icalCacheSek = 0;
});

test('stary klucz z całym plikiem iCal jest kasowany', async () => {
  assert.ok(!('icalCache' in stan.magazyn), 'legacy icalCache usunięty przy starcie workera');
});

test('przepełnione storage nie wywraca sprawdzania dostępności', async () => {
  delete stan.magazyn.icalEventy;
  stan.limitBajtow = 10; // każdy zapis > 10 B rzuca „quota exceeded", tak jak Chrome na limicie
  try {
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    assert.equal(odp.ok, true, `dostępność policzona mimo błędu zapisu: ${odp.blad || ''}`);
    assert.match(odp.wynik.tekst, /ZAJĘTE|wolne|Wolne/);
  } finally {
    stan.limitBajtow = 0;
  }
});

test('data spoza okna cache liczy się na świeżym pobraniu', async () => {
  delete stan.magazyn.icalEventy;
  stan.magazyn.icalCacheSek = 300;
  await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });
  const pobranDo = stan.magazyn.icalEventy.okno.do;

  const daleka = `${Number(pobranDo.slice(0, 4)) + 2}-05-18`;
  const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: daleka, osoby: 2, czasTrwaniaMin: 30 });
  assert.equal(odp.ok, true);
  assert.equal(odp.wynik.zrodlo.zCache, false, 'data spoza okna omija cache');
  stan.magazyn.icalCacheSek = 0;
});

test('HTTP 500 z eksportu iCal jest ponawiany', async () => {
  delete stan.magazyn.icalEventy;
  const oryginalny = globalThis.fetch;
  let prob = 0;
  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) return oryginalny(url, opcje);
    prob++;
    // Google zwraca 500, gdy eksport dużego kalendarza nie zmieści się w jego limicie czasu.
    if (prob === 1) return { ok: false, status: 500, text: async () => '' };
    return odpowiedzICal(ICAL);
  };
  try {
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    assert.equal(odp.ok, true, `po retry dostępność policzona: ${odp.blad || ''}`);
    assert.equal(prob, 2, 'druga próba wystarczyła');
  } finally {
    globalThis.fetch = oryginalny;
  }
});

test('404 nie jest ponawiany — to błąd samego linku', async () => {
  delete stan.magazyn.icalEventy;
  const oryginalny = globalThis.fetch;
  let prob = 0;
  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) return oryginalny(url, opcje);
    prob++;
    return { ok: false, status: 404, text: async () => '' };
  };
  try {
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    assert.equal(odp.ok, false);
    assert.match(odp.blad, /404/);
    assert.equal(prob, 1, '404 nie jest ponawiany');
  } finally {
    globalThis.fetch = oryginalny;
  }
});

test('urwany plik iCal jest odrzucany, nie liczony jako pusty kalendarz', async () => {
  delete stan.magazyn.icalEventy;
  const oryginalny = globalThis.fetch;
  // Ucięte na granicy zdarzenia: jest BEGIN:VCALENDAR, nie ma END:VCALENDAR.
  const urwany = ICAL.slice(0, ICAL.indexOf('END:VCALENDAR'));
  let prob = 0;
  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) return oryginalny(url, opcje);
    prob++;
    return odpowiedzICal(urwany);
  };
  try {
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    assert.equal(odp.ok, false, 'niekompletny kalendarz musi być błędem, nie cichym „wszystko wolne"');
    assert.equal(prob, 3, 'urwany strumień jest ponawiany');
  } finally {
    globalThis.fetch = oryginalny;
  }
});

test('składanie linii działa przez granicę fragmentu strumienia', async () => {
  delete stan.magazyn.icalEventy;
  const oryginalny = globalThis.fetch;
  // Data musi wpaść w okno −7/+190 dni, inaczej filtr strumienia słusznie odrzuci wydarzenie.
  const za30dni = new Date(Date.now() + 30 * 24 * 3600e3);
  const d = `${za30dni.getFullYear()}${String(za30dni.getMonth() + 1).padStart(2, '0')}${String(za30dni.getDate()).padStart(2, '0')}`;
  const zeSkladaniem = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:a', `DTSTART;TZID=Europe/Warsaw:${d}T120000`,
    `DTEND;TZID=Europe/Warsaw:${d}T133000`,
    // RFC 5545: składanie zjada CRLF i JEDEN znak wcięcia, więc łamiemy w środku słowa.
    'SUMMARY:Rezerwacja dla grupy czterech os', ' ob z instrukt', ' orem',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) return oryginalny(url, opcje);
    return odpowiedzICal(zeSkladaniem, { rozmiarFragmentu: 3 });   // granice w środku składania
  };
  try {
    const odp = await wyslij({ typ: 'ICAL_DIAGNOSTYKA' });
    assert.equal(odp.ok, true);
    assert.equal(odp.raport.probka[0].tytul, 'Rezerwacja dla grupy czterech osob z instruktorem');
  } finally {
    globalThis.fetch = oryginalny;
  }
});

test('przeterminowany cache odpowiada od ręki, świeże dane lecą w tle', async () => {
  // Warunek początkowy jawnie: od 2.3.0 cache zapisuje też diagnostyka, więc poprzedni test
  // zostawia po sobie ciepły wpis.
  delete stan.magazyn.icalEventy;
  stan.magazyn.icalCacheSek = 3600;
  const oryginalny = globalThis.fetch;
  let pobran = 0;
  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) return oryginalny(url, opcje);
    pobran++;
    return odpowiedzICal(ICAL);
  };
  // Data musi leżeć w oknie cache'u (−7/+190 dni), inaczej zapytanie z definicji omija cache.
  const w = new Date(Date.now() + 30 * 24 * 3600e3);
  const wOknie = `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`;
  try {
    // Zapełnij cache, potem cofnij jego znacznik czasu o 2 h — po TTL, ale w oknie awaryjnym.
    await wyslij({ typ: 'DOSTEPNOSC', dataISO: wOknie, osoby: 2, czasTrwaniaMin: 30 });
    assert.equal(pobran, 1, 'pierwsze zapytanie pobiera kalendarz');
    stan.magazyn.icalEventy.czas = Date.now() - 2 * 3600e3;

    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: wOknie, osoby: 2, czasTrwaniaMin: 30 });
    assert.equal(odp.ok, true);
    assert.equal(odp.wynik.zrodlo.zCache, true, 'odpowiedź z cache, bez czekania na 47 MB');
    assert.equal(odp.wynik.zrodlo.przeterminowany, true, 'oznaczona jako przeterminowana');
    assert.ok(odp.wynik.zrodlo.wiekMin >= 119, `wiek cache'u raportowany (${odp.wynik.zrodlo.wiekMin} min)`);
  } finally {
    globalThis.fetch = oryginalny;
    stan.magazyn.icalCacheSek = 0;
  }
});

test('odczyt na żywo nadpisuje dzień z iCal', async () => {
  delete stan.magazyn.icalEventy;
  delete stan.magazyn.kalendarzDni;
  delete stan.magazyn.naZywoBlokada;   // wcześniejsze testy zdążyły ją ustawić
  stan.magazyn.naZywo = { wlaczona: true, cacheSek: 180, timeoutMs: 2000 };
  // Kalendarz na żywo mówi: instruktorzy na urlopie cały dzień → nic nie jest wolne.
  stan.chipy = [{ czas: 'Od 10:00 do 19:30, x', tytul: 'Instruktor - urlop', aria: '' }];
  try {
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    assert.equal(odp.ok, true);
    assert.equal(odp.wynik.zrodlo.dzienNaZywo, true, 'dzień potwierdzony z Kalendarza');
    assert.equal(stan.karty.length, 0, 'własna karta zamknięta po odczycie');
  } finally {
    stan.chipy = null;
    delete stan.magazyn.naZywo;
  }
});

test('seria pytań o ten sam dzień czyta Kalendarz tylko raz', async () => {
  delete stan.magazyn.icalEventy;
  delete stan.magazyn.kalendarzDni;
  delete stan.magazyn.naZywoBlokada;   // wcześniejsze testy zdążyły ją ustawić
  stan.magazyn.naZywo = { wlaczona: true, cacheSek: 180, timeoutMs: 2000 };
  stan.nawigacje = [];
  stan.calendarCreates = 0;
  stan.chipy = [{ czas: 'Od 12:00 do 13:30, x', tytul: '4os - GB', aria: '' }];
  stan.kartyKalendarza = [{ id: 99, url: 'https://calendar.google.com/calendar/u/0/r' }];
  try {
    for (let i = 0; i < 3; i++) {
      const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
      assert.equal(odp.wynik.zrodlo.dzienNaZywo, true, `zapytanie ${i + 1} ma dane na żywo`);
    }
    assert.equal(stan.calendarCreates, 1, 'Własna karta utworzona raz mimo trzech zapytań');
    assert.equal(stan.nawigacje.length, 0, 'Nie przełączamy karty użytkownika');
  } finally {
    stan.chipy = null;
    stan.kartyKalendarza = [];
    delete stan.magazyn.naZywo;
  }
});

test('niedostępny Kalendarz nie wywraca dostępności — liczymy z iCal', async () => {
  delete stan.magazyn.icalEventy;
  delete stan.magazyn.kalendarzDni;
  delete stan.magazyn.naZywoBlokada;   // wcześniejsze testy zdążyły ją ustawić
  stan.magazyn.naZywo = { wlaczona: true, cacheSek: 180, timeoutMs: 1000 };
  stan.chipy = null;   // executeScript rzuca
  try {
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    assert.equal(odp.ok, true, 'awaria odczytu na żywo nie może wywrócić wyniku');
    assert.equal(odp.wynik.zrodlo.dzienNaZywo, false, 'oznaczone jako policzone z iCal');
    assert.match(odp.wynik.tekst, /ZAJĘTE|wolne|Wolne|brak/);
  } finally {
    delete stan.magazyn.naZywo;
  }
});

test('po nieudanym odczycie Kalendarz nie jest odpytywany przy każdym zapytaniu', async () => {
  delete stan.magazyn.icalEventy;
  delete stan.magazyn.kalendarzDni;
  delete stan.magazyn.naZywoBlokada;
  stan.magazyn.naZywo = { wlaczona: true, cacheSek: 180, timeoutMs: 12000 };
  stan.chipy = null;          // executeScript rzuca — odczyt na żywo zawodzi
  stan.nawigacje = [];
  stan.calendarCreates = 0;
  stan.kartyKalendarza = [{ id: 99, url: 'https://calendar.google.com/calendar/u/0/r' }];
  try {
    const start = Date.now();
    for (let i = 0; i < 3; i++) {
      await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    }
    assert.equal(stan.calendarCreates, 1, 'po pierwszej porażce odpuszczamy — jedna próba na trzy zapytania');
    assert.equal(stan.nawigacje.length, 0, 'Nie przełączamy karty użytkownika');
    assert.ok(Date.now() - start < 3000, `trzy zapytania bez zwłoki (${Date.now() - start} ms)`);
  } finally {
    stan.kartyKalendarza = [];
    delete stan.magazyn.naZywo;
    delete stan.magazyn.naZywoBlokada;
  }
});

/* ────────── Regresja A1: pusty dzień to wynik, nie awaria odczytu ────────── */

test('pusty dzień w Kalendarzu jest odczytem udanym, bez blokady i bez czekania na timeout', async () => {
  delete stan.magazyn.icalEventy;
  delete stan.magazyn.kalendarzDni;
  delete stan.magazyn.naZywoBlokada;
  stan.magazyn.naZywo = { wlaczona: true, cacheSek: 0, timeoutMs: 12000 };
  stan.chipy = [];   // Kalendarz wyrenderowany, tego dnia po prostu nic nie ma
  try {
    const start = Date.now();
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    const trwalo = Date.now() - start;

    assert.equal(odp.ok, true);
    assert.equal(odp.wynik.zrodlo.dzienNaZywo, true, 'pusty widok to potwierdzony odczyt, nie porażka');
    assert.ok(trwalo < 6000, `bez odczekiwania pełnego timeoutu (${trwalo} ms z 12 000 ms)`);
    assert.ok(!('naZywoBlokada' in stan.magazyn), 'pusty dzień nie zapala blokady odczytów na żywo');
    // Dzień bez wydarzeń to dzień bez obsady instruktorów — czyli brak terminów, nie „wszystko wolne".
    assert.match(odp.wynik.tekst, /Brak wolnych terminów/);
  } finally {
    stan.chipy = null;
    delete stan.magazyn.naZywo;
  }
});

test('chipy z widoku innego dnia nie są liczone jako rezerwacje pytanej daty', async () => {
  delete stan.magazyn.icalEventy;
  delete stan.magazyn.kalendarzDni;
  delete stan.magazyn.naZywoBlokada;
  stan.magazyn.naZywo = { wlaczona: true, cacheSek: 0, timeoutMs: 1500 };
  // Kalendarz utknął na poprzednim dniu — w DOM-ie są chipy, ale nie tego terminu.
  stan.sciezkaKalendarza = '/calendar/u/0/r/day/2026/5/17';
  stan.chipy = [{ czas: 'Od 10:00 do 19:30, x', tytul: 'Instruktor - urlop', aria: '' }];
  try {
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    assert.equal(odp.ok, true, 'zły widok nie może wywrócić wyniku');
    assert.equal(odp.wynik.zrodlo.dzienNaZywo, false, 'odczyt odrzucony — liczymy z iCal');
    // iCal zna ten dzień: obsada 2 instruktorów, rezerwacja 4os o 12:00.
    assert.equal(odp.wynik.sloty.find((s) => s.od === '13:30').dostepny, true);
  } finally {
    stan.chipy = null;
    delete stan.sciezkaKalendarza;
    delete stan.magazyn.naZywo;
    delete stan.magazyn.naZywoBlokada;
  }
});

/* ────────── Regresja A3: wywołanie modelu ma timeout i ponawia przeciążenie ────────── */

test('429 z OpenRouter jest ponawiany, 400 nie', async () => {
  const oryginalny = globalThis.fetch;
  let prob = 0;
  globalThis.fetch = async (url, opcje) => {
    if (!String(url).includes('openrouter')) return oryginalny(url, opcje);
    prob++;
    if (prob === 1) return { ok: false, status: 429, headers: { get: () => '0' }, text: async () => 'rate limited' };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Draft.' } }] }) };
  };
  try {
    const odp = await wyslij({ typ: 'AI', funkcja: 'tlumacz', tresc: 'test' });
    assert.equal(odp.ok, true, `po retry model odpowiedział: ${odp.blad || ''}`);
    assert.equal(prob, 2, 'druga próba wystarczyła');

    prob = 0;
    globalThis.fetch = async (url, opcje) => {
      if (!String(url).includes('openrouter')) return oryginalny(url, opcje);
      prob++;
      return { ok: false, status: 400, text: async () => 'zły model' };
    };
    const zly = await wyslij({ typ: 'AI', funkcja: 'tlumacz', tresc: 'test' });
    assert.equal(zly.ok, false);
    assert.match(zly.blad, /400/);
    assert.equal(prob, 1, '400 powtórzy się co do joty — nie ponawiamy');
  } finally {
    globalThis.fetch = oryginalny;
  }
});

test('odpowiedź urwana na limicie tokenów jest oznaczona i nie trafia do Gmaila jako draft', async () => {
  const oryginalny = globalThis.fetch;
  globalThis.fetch = async (url, opcje) => {
    if (!String(url).includes('openrouter')) return oryginalny(url, opcje);
    stan.zapytaniaAI++;
    return { ok: true, status: 200, json: async () => ({
      choices: [{ message: { content: 'Dzień dobry, termin 18.05 jest wol' }, finish_reason: 'length' }],
    }) };
  };
  try {
    const odp = await wyslij({ typ: 'AI', funkcja: 'tlumacz', tresc: 'test' });
    assert.equal(odp.ok, true);
    assert.equal(odp.obciety, true, 'ucięta odpowiedź jest oznaczona');

    // W trybie semi-auto ucięty draft musi być błędem — wstrzyknięty wyglądałby na gotowy.
    await wyslij({ typ: 'SEMIAUTO_RESET_DEDUP' });
    stan.doKarty = [];
    const cykl = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
    assert.equal(cykl.draftow, 0, 'żaden draft nie powstał');
    assert.equal(cykl.bledy.length, 1);
    assert.match(cykl.bledy[0], /Jev:/, 'tekstowy format odpowiedzi nie jest akceptowany jako decyzje Jev');
    assert.ok(!stan.doKarty.includes('WSTRZYKNIJ_DRAFT'), 'nic nie trafiło do karty Gmaila');
  } finally {
    globalThis.fetch = oryginalny;
  }
});

/* ────────── Regresja A4: znacznik „w toku" w mapie deduplikacji ────────── */

test('znany błąd zwalnia wątek — wraca w następnym cyklu', async () => {
  await wyslij({ typ: 'SEMIAUTO_RESET_DEDUP' });
  const oryginalny = globalThis.fetch;
  globalThis.fetch = async (url, opcje) => {
    if (!String(url).includes('openrouter')) return oryginalny(url, opcje);
    return { ok: false, status: 400, text: async () => 'zły model' };
  };
  try {
    const zepsuty = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
    assert.equal(zepsuty.draftow, 0);
    assert.deepEqual(stan.magazyn.dedup, {}, 'po błędzie, o którym wiemy, znacznik jest zdjęty');
  } finally {
    globalThis.fetch = oryginalny;
  }

  const naprawiony = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
  assert.equal(naprawiony.draftow, 1, 'wątek wrócił, gdy model znów działa');
  assert.equal(stan.magazyn.dedup.T1.stan, 'gotowe');
});

test('wpis „w toku" po ubitym workerze nie daje drugiego draftu na tym samym wątku', async () => {
  await wyslij({ typ: 'SEMIAUTO_RESET_DEDUP' });
  // Tak wygląda storage po workerze ubitym między wstrzyknięciem draftu a zapisem stanu.
  await chrome.storage.local.set({ dedup: { T1: { messageId: 'M1', czas: Date.now(), stan: 'wToku' } } });
  stan.doKarty = [];

  const odp = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
  assert.equal(odp.draftow, 0, 'nie nadpisujemy draftu, który mógł już zostać poprawiony ręcznie');
  assert.equal(odp.przerwane, 1, 'przerwany wątek jest raportowany osobno od zwykłego dedupu');
  assert.equal(odp.pominieteDedup, 0);
  assert.ok(!stan.doKarty.includes('WSTRZYKNIJ_DRAFT'));

  const status = await wyslij({ typ: 'SEMIAUTO_STATUS' });
  assert.ok(status.log.some((w) => /przerwano w trakcie/.test(w.tekst)), 'powód widać w logu');
});

test('wpisy sprzed 2.3.0 (bez pola stan) czytane są jako gotowe', async () => {
  await wyslij({ typ: 'SEMIAUTO_RESET_DEDUP' });
  await chrome.storage.local.set({ dedup: { T1: { messageId: 'M1', czas: Date.now() } } });

  const odp = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
  assert.equal(odp.pominieteDedup, 1, 'stary wpis to zwykły dedup, nie wątek przerwany');
  assert.equal(odp.przerwane, 0);
});

test('karta, która nie potwierdziła wstrzyknięcia, zostaje „w toku" — wynik jest nieznany', async () => {
  await wyslij({ typ: 'SEMIAUTO_RESET_DEDUP' });
  const oryginal = chrome.tabs.sendMessage;
  // Karta znika w trakcie wstrzykiwania: draft mógł już wylądować w Gmailu, a potwierdzenie
  // do nas nie wróciło. Dokładnie ten przypadek, w którym NIE wolno zwolnić wątku.
  // (To samo dzieje się po 40-sekundowym timeoucie `wyslijDoKarty` — tylko szybciej.)
  chrome.tabs.sendMessage = async (id, msg) => {
    if (msg.typ === 'WSTRZYKNIJ_DRAFT') throw new Error('Receiving end does not exist.');
    return oryginal(id, msg);
  };
  try {
    const odp = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
    assert.equal(odp.draftow, 0);
    assert.equal(odp.bledy.length, 1);
    assert.equal(stan.magazyn.dedup.T1?.stan, 'wToku', 'znacznik zostaje — wyniku nie znamy');
  } finally {
    chrome.tabs.sendMessage = oryginal;
  }

  // Następny cykl nie może nadpisać draftu, który mógł już wylądować w Gmailu.
  stan.doKarty = [];
  const kolejny = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
  assert.equal(kolejny.przerwane, 1);
  assert.ok(!stan.doKarty.includes('WSTRZYKNIJ_DRAFT'));
});

test('odmowa Gmaila zwalnia wątek — tu wynik znamy', async () => {
  await wyslij({ typ: 'SEMIAUTO_RESET_DEDUP' });
  const oryginal = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (id, msg) => {
    if (msg.typ === 'WSTRZYKNIJ_DRAFT') return { ok: false, blad: 'Nie znaleziono pola odpowiedzi.' };
    return oryginal(id, msg);
  };
  try {
    const odp = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
    assert.equal(odp.draftow, 0);
    assert.deepEqual(stan.magazyn.dedup, {}, 'Gmail powiedział wprost, że nic nie wstawił');
  } finally {
    chrome.tabs.sendMessage = oryginal;
  }
});

/* ────────── Regresja: jedno pobranie iCal naraz, na WSZYSTKICH ścieżkach ────────── */

/** Atrapa wolnego pobrania — bez zwłoki równoległość nie miałaby czego pokazać. */
function wolnyICal(licznik, tekst = ICAL) {
  const oryginalny = globalThis.fetch;
  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) return oryginalny(url, opcje);
    licznik.n++;
    await new Promise((r) => setTimeout(r, 100));
    return odpowiedzICal(tekst);
  };
  return () => { globalThis.fetch = oryginalny; };
}

test('dwa równoległe sprawdzenia z pustym cache dzielą jedno pobranie', async () => {
  delete stan.magazyn.icalEventy;
  stan.magazyn.icalCacheSek = 3600;
  const licznik = { n: 0 };
  const przywroc = wolnyICal(licznik);
  try {
    const [a, b] = await Promise.all([
      wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 }),
      wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 }),
    ]);
    assert.equal(licznik.n, 1, 'jedno pobranie, nie dwa');
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.deepEqual(a.wynik.sloty, b.wynik.sloty, 'oba zapytania dostają ten sam wynik');
  } finally {
    przywroc();
    stan.magazyn.icalCacheSek = 0;
  }
});

/** Data w oknie −7/+190 dni — tylko takie dzielą pobranie uruchomione bez konkretnej daty. */
function dataWOknie(zaIleDni = 30) {
  const d = new Date(Date.now() + zaIleDni * 24 * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('diagnostyka dołącza się do trwającego pobrania zamiast ciągnąć drugie', async () => {
  delete stan.magazyn.icalEventy;
  stan.magazyn.icalCacheSek = 3600;
  const licznik = { n: 0 };
  const przywroc = wolnyICal(licznik);
  try {
    const [zapytanie, raport] = await Promise.all([
      wyslij({ typ: 'DOSTEPNOSC', dataISO: dataWOknie(), osoby: 2, czasTrwaniaMin: 30 }),
      wyslij({ typ: 'ICAL_DIAGNOSTYKA' }),
    ]);
    assert.equal(licznik.n, 1, 'jedno pobranie na obie ścieżki');
    assert.equal(zapytanie.ok, true);
    assert.equal(raport.ok, true);
    assert.equal(raport.raport.eventow, 2, 'diagnostyka nadal raportuje realne liczby');
  } finally {
    przywroc();
    stan.magazyn.icalCacheSek = 0;
  }
});

test('diagnostyka zapisuje cache — następne sprawdzenie nie pobiera drugi raz', async () => {
  delete stan.magazyn.icalEventy;
  stan.magazyn.icalCacheSek = 3600;
  const licznik = { n: 0 };
  const przywroc = wolnyICal(licznik);
  try {
    // Naturalna pierwsza czynność użytkownika: „Testuj link iCal", zaraz potem sprawdzenie terminu.
    const raport = await wyslij({ typ: 'ICAL_DIAGNOSTYKA' });
    assert.equal(raport.ok, true);
    assert.equal(licznik.n, 1);
    assert.ok(stan.magazyn.icalEventy, 'diagnostyka wypełnia cache, zamiast wyrzucać pobrane dane');
    assert.equal(raport.raport.cacheZapisany, true);

    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: dataWOknie(), osoby: 2, czasTrwaniaMin: 30 });
    assert.equal(odp.wynik.zrodlo.zCache, true, 'sprawdzenie trafia w cache po diagnostyce');
    assert.equal(licznik.n, 1, 'w sumie jedno pobranie, nie dwa');
  } finally {
    przywroc();
    stan.magazyn.icalCacheSek = 0;
  }
});

test('data spoza okna NIE dołącza się do pobrania filtrowanego pod inną datę', async () => {
  delete stan.magazyn.icalEventy;
  stan.magazyn.icalCacheSek = 3600;

  // Kalendarz z wydarzeniami w dwóch odległych latach. Filtr strumienia zachowuje okno
  // −7/+190 dni PLUS jeden dołożony dzień, więc pobranie pod datę A odsiewa datę B.
  const zaLata = new Date(Date.now() + 500 * 24 * 3600e3);
  const rokA = zaLata.getFullYear();
  const dataA = `${rokA}-05-18`;
  const dataB = `${rokA + 1}-05-18`;
  const stamp = (iso, hhmm) => `${iso.replace(/-/g, '')}T${hhmm}00`;
  const dwaLata = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:obsadaA', `DTSTART;TZID=Europe/Warsaw:${stamp(dataA, '1100')}`,
    `DTEND;TZID=Europe/Warsaw:${stamp(dataA, '1830')}`, 'SUMMARY:2', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:obsadaB', `DTSTART;TZID=Europe/Warsaw:${stamp(dataB, '1100')}`,
    `DTEND;TZID=Europe/Warsaw:${stamp(dataB, '1830')}`, 'SUMMARY:2', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const licznik = { n: 0 };
  const przywroc = wolnyICal(licznik, dwaLata);
  try {
    const [a, b] = await Promise.all([
      wyslij({ typ: 'DOSTEPNOSC', dataISO: dataA, osoby: 2, czasTrwaniaMin: 30 }),
      wyslij({ typ: 'DOSTEPNOSC', dataISO: dataB, osoby: 2, czasTrwaniaMin: 30 }),
    ]);
    assert.equal(licznik.n, 2, 'rozłączne pokrycie dat wymaga dwóch pobrań — dzielenie byłoby błędem');

    // Sedno: obie daty mają w kalendarzu obsadę, więc obie muszą wyjść jako otwarte.
    // Podpięcie B pod pobranie A dałoby „brak obsady" dla dnia, który jest obsadzony.
    for (const [nazwa, odp] of [['A', a], ['B', b]]) {
      assert.equal(odp.ok, true, `zapytanie ${nazwa} policzone`);
      assert.ok(odp.wynik.sloty.some((s) => s.dostepny), `zapytanie ${nazwa} widzi obsadę z kalendarza`);
    }
  } finally {
    przywroc();
    stan.magazyn.icalCacheSek = 0;
  }
});

test('nieudane pobranie nie blokuje rejestru na stałe', async () => {
  delete stan.magazyn.icalEventy;
  stan.magazyn.icalCacheSek = 3600;
  const oryginalny = globalThis.fetch;
  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) return oryginalny(url, opcje);
    return { ok: false, status: 404, text: async () => '' };
  };
  try {
    const zly = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });
    assert.equal(zly.ok, false);
  } finally {
    globalThis.fetch = oryginalny;
  }

  const licznik = { n: 0 };
  const przywroc = wolnyICal(licznik);
  try {
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });
    assert.equal(odp.ok, true, 'po porażce kolejne pobranie startuje normalnie');
    assert.equal(licznik.n, 1);
  } finally {
    przywroc();
    stan.magazyn.icalCacheSek = 0;
  }
});

test('data spoza okna nie dołącza się do pobrania uruchomionego bez konkretnej daty', async () => {
  delete stan.magazyn.icalEventy;
  stan.magazyn.icalCacheSek = 3600;

  // Wydarzenie z obsadą daleko poza oknem −7/+190 dni. Diagnostyka pobiera bez `dataISO`,
  // więc jej filtr strumienia ten dzień odsiewa — zapytanie o niego musi pobrać osobno.
  const daleka = new Date(Date.now() + 500 * 24 * 3600e3);
  const dataISO = `${daleka.getFullYear()}-${String(daleka.getMonth() + 1).padStart(2, '0')}-${String(daleka.getDate()).padStart(2, '0')}`;
  const bezMyslnikow = dataISO.replace(/-/g, '');
  const kalendarz = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:daleka', `DTSTART;TZID=Europe/Warsaw:${bezMyslnikow}T110000`,
    `DTEND;TZID=Europe/Warsaw:${bezMyslnikow}T183000`, 'SUMMARY:2', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const licznik = { n: 0 };
  const przywroc = wolnyICal(licznik, kalendarz);
  try {
    const [raport, odp] = await Promise.all([
      wyslij({ typ: 'ICAL_DIAGNOSTYKA' }),
      wyslij({ typ: 'DOSTEPNOSC', dataISO, osoby: 2, czasTrwaniaMin: 30 }),
    ]);
    assert.equal(raport.ok, true);
    assert.equal(odp.ok, true);
    assert.equal(licznik.n, 2, 'rozłączne pokrycie — dzielenie dałoby „brak wydarzeń" dla tego dnia');
    // Sedno: dzień ma w kalendarzu obsadę i musi ją zobaczyć mimo równoległej diagnostyki.
    assert.ok(odp.wynik.sloty.some((s) => s.dostepny), 'obsada spoza okna jest widoczna');
  } finally {
    przywroc();
    stan.magazyn.icalCacheSek = 0;
  }
});

/* ────────── Regresja: budżet czasu obejmuje ODCZYT CIAŁA, nie tylko nadejście nagłówków ────────── */

/**
 * Ciało odpowiedzi, które nigdy nie oddaje danych, ale — jak prawdziwy `fetch` — odrzuca
 * oczekiwanie, gdy zadziała `AbortSignal`. Bez tego drugiego atrapa nie odtwarzałaby niczego:
 * przy skasowanym timerze test wisiałby zamiast zawieść.
 */
function zwisleCialo(signal) {
  return new Promise((_, odrzuc) => {
    if (signal.aborted) return odrzuc(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    signal.addEventListener('abort', () => odrzuc(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
  });
}

/** Skraca limity na czas jednego testu i przywraca je po nim. */
function zLimitami(nadpisania) {
  Object.assign(bg.LIMITY, nadpisania);
  return () => Object.assign(bg.LIMITY, limityDomyslne);
}

test('zwisły strumień iCal jest przerywany — timer obejmuje odczyt ciała', { timeout: 15000 }, async () => {
  delete stan.magazyn.icalEventy;
  const przywrocLimity = zLimitami({ icalCisza: 200, icalProba: 5_000, icalBudzet: 10_000, icalMinProby: 50, icalPrzerwy: [50, 50] });
  const oryginalny = globalThis.fetch;
  let prob = 0;
  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) return oryginalny(url, opcje);
    prob++;
    // Nagłówki przychodzą natychmiast (tak działa odpowiedź chunked), a ciało nie oddaje nic.
    // Stary kod kasował timer właśnie tutaj i `read()` wisiał już bez żadnego limitu.
    return { ok: true, status: 200, body: { getReader: () => ({ read: () => zwisleCialo(opcje.signal) }) } };
  };
  try {
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    assert.equal(odp.ok, false, 'zwisłe pobranie musi zawieść, a nie wisieć');
    assert.match(odp.blad, /zwis|Nie udało się pobrać/i);
    assert.equal(prob, 3, 'cisza na łączu jest ponawiana — to awaria zwykle chwilowa');
  } finally {
    globalThis.fetch = oryginalny;
    przywrocLimity();
  }
});

test('strumień, który ruszył po chwili ciszy, nie jest zabijany przedwcześnie', { timeout: 15000 }, async () => {
  delete stan.magazyn.icalEventy;
  const przywrocLimity = zLimitami({ icalCisza: 400, icalProba: 8_000, icalBudzet: 10_000, icalMinProby: 50 });
  const oryginalny = globalThis.fetch;
  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) return oryginalny(url, opcje);
    const bajty = new TextEncoder().encode(ICAL);
    let i = 0;
    return { ok: true, status: 200, body: { getReader: () => ({
      // Każdy kawałek po 250 ms — poniżej limitu ciszy, ale łącznie znacznie powyżej niego.
      // Limit ciszy ma się odraczać przy KAŻDYM bajcie, nie liczyć od początku pobrania.
      async read() {
        if (i >= bajty.length) return { done: true, value: undefined };
        await new Promise((r) => setTimeout(r, 250));
        const kawalek = bajty.slice(i, i + 40);
        i += 40;
        return { done: false, value: kawalek };
      },
    }) } };
  };
  try {
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    assert.equal(odp.ok, true, `wolne, ale żywe pobranie musi się udać: ${odp.blad || ''}`);
  } finally {
    globalThis.fetch = oryginalny;
    przywrocLimity();
  }
});

test('wyczerpany budżet całości nie jest ponawiany', { timeout: 15000 }, async () => {
  delete stan.magazyn.icalEventy;
  // Budżet całości krótszy niż limit ciszy — pierwsza próba wyczerpie go, zanim cisza zdąży zadziałać.
  const przywrocLimity = zLimitami({ icalCisza: 10_000, icalProba: 5_000, icalBudzet: 400, icalMinProby: 50, icalPrzerwy: [50, 50] });
  const oryginalny = globalThis.fetch;
  let prob = 0;
  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) return oryginalny(url, opcje);
    prob++;
    return { ok: true, status: 200, body: { getReader: () => ({ read: () => zwisleCialo(opcje.signal) }) } };
  };
  try {
    const odp = await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    assert.equal(odp.ok, false);
    assert.match(odp.blad, /nie oddał całości/);
    assert.equal(prob, 1, 'powtórka trwałaby tyle samo — nie ponawiamy');
  } finally {
    globalThis.fetch = oryginalny;
    przywrocLimity();
  }
});

test('zwisłe ciało odpowiedzi modelu też jest przerywane', { timeout: 15000 }, async () => {
  const przywrocLimity = zLimitami({ model: 250 });
  const oryginalny = globalThis.fetch;
  globalThis.fetch = async (url, opcje) => {
    if (!String(url).includes('openrouter')) return oryginalny(url, opcje);
    // Nagłówki natychmiast, `json()` nigdy — model streamuje odpowiedź, więc to ciało trwa najdłużej.
    return { ok: true, status: 200, json: () => zwisleCialo(opcje.signal) };
  };
  try {
    const odp = await wyslij({ typ: 'AI', funkcja: 'tlumacz', tresc: 'test' });
    assert.equal(odp.ok, false, 'zwisłe wywołanie modelu musi zawieść, a nie wisieć');
    assert.match(odp.blad, /Model nie odpowiedział/);
  } finally {
    globalThis.fetch = oryginalny;
    przywrocLimity();
  }
});

test('długa operacja podtrzymuje service workera wywołaniami API rozszerzeń', { timeout: 15000 }, async () => {
  // Chrome ubija workera po 30 s bezczynności, a licznik resetują tylko zdarzenia i wywołania API.
  // Czytanie strumienia nie woła niczego — stąd tykanie w tle na czas pobrania.
  assert.equal(typeof chrome.runtime.getPlatformInfo, 'function');
  const przedtem = stan.podtrzyman;

  delete stan.magazyn.icalEventy;
  const przywrocLimity = zLimitami({ icalCisza: 5_000, icalProba: 8_000, icalBudzet: 10_000 });
  const oryginalny = globalThis.fetch;
  globalThis.fetch = async (url, opcje) => {
    if (String(url).includes('openrouter')) return oryginalny(url, opcje);
    return odpowiedzICal(ICAL);
  };
  try {
    await wyslij({ typ: 'DOSTEPNOSC', dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30, pomijCache: true });
    // Pobranie w teście trwa milisekundy, więc tykanie (co 20 s) nie zdąży wystrzelić — sprawdzamy
    // to, co da się sprawdzić deterministycznie: że nie zostawia po sobie działającego interwału.
    assert.equal(stan.podtrzyman, przedtem, 'krótkie pobranie nie potrzebuje ani jednego tyknięcia');
  } finally {
    globalThis.fetch = oryginalny;
    przywrocLimity();
  }
});

/* ────────── Regresja: brak stabilnego ID zatrzymuje automat, zamiast zgadywać ────────── */

test('wątek bez ID ostatniej wiadomości jest pomijany z czytelnym powodem', async () => {
  await wyslij({ typ: 'SEMIAUTO_RESET_DEDUP' });
  const oryginal = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (id, msg) => {
    if (msg.typ === 'OTWORZ_WATEK') {
      const w = await oryginal(id, msg);
      // Tak wygląda odczyt, gdy selektory Gmaila się zmieniły: treść jest, identyfikatorów nie ma.
      w.dane.wiadomosci = w.dane.wiadomosci.map((wiad) => ({ ...wiad, id: null }));
      w.dane.ostatniaWiadomoscId = null;
      w.dane.ostrzezenia = ['Nie udało się odczytać identyfikatorów wiadomości — tryb semi-auto pominie ten wątek.'];
      return w;
    }
    return oryginal(id, msg);
  };
  stan.doKarty = [];
  try {
    const odp = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
    assert.equal(odp.draftow, 0, 'bez ID nie da się zdeduplikować, więc nie draftujemy');
    assert.equal(odp.bledy.length, 1);
    assert.match(odp.bledy[0], /stabilnego identyfikatora/);
    assert.ok(!stan.doKarty.includes('WSTRZYKNIJ_DRAFT'), 'nic nie trafiło do Gmaila');
    assert.deepEqual(stan.magazyn.dedup, {}, 'mapa deduplikacji nie zaśmieca się zmyślonym ID');

    const status = await wyslij({ typ: 'SEMIAUTO_STATUS' });
    assert.ok(status.log.some((w) => /stabilnego identyfikatora/.test(w.tekst)), 'powód widać w logu');
  } finally {
    chrome.tabs.sendMessage = oryginal;
  }
});

test('ostrzeżenia z odczytu wątku trafiają do logu semi-auto', async () => {
  await wyslij({ typ: 'SEMIAUTO_RESET_DEDUP' });
  const oryginal = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (id, msg) => {
    if (msg.typ === 'OTWORZ_WATEK') {
      const w = await oryginal(id, msg);
      w.dane.ostrzezenia = ['Część wiadomości w wątku jest zwinięta — kliknij „Rozwiń wszystkie".'];
      return w;
    }
    return oryginal(id, msg);
  };
  try {
    const odp = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
    assert.equal(odp.draftow, 0, 'niepełny kontekst blokuje nowy automat Jev');
    const status = await wyslij({ typ: 'SEMIAUTO_STATUS' });
    assert.ok(status.log.some((w) => /zwinięta/.test(w.tekst)),
      'automat pracuje na niepełnym kontekście — musi to odnotować');
  } finally {
    chrome.tabs.sendMessage = oryginal;
  }
});

test('manualny zapis Jev i semi-auto współdzielą deduplikację',async()=>{
  await wyslij({typ:'SEMIAUTO_RESET_DEDUP'});
  const msg={typ:'JEV_SAVE_DRAFT',tabId:1,threadId:'manual',messageId:'M9',snapshot:'snapshot',text:'Testowy draft'};
  const before=stan.doKarty.filter(x=>x==='WSTRZYKNIJ_DRAFT').length;
  const [first,second]=await Promise.all([wyslij(msg),wyslij(msg)]);
  assert.equal(first.ok,true);assert.equal(second.ok,false);
  assert.equal(stan.doKarty.filter(x=>x==='WSTRZYKNIJ_DRAFT').length-before,1);
  assert.equal(stan.magazyn.dedup.manual.stan,'gotowe');
});
test('tryb porównawczy nie tworzy draftów i nie powtarza analizy bez zmiany maila',async()=>{
  await wyslij({typ:'SEMIAUTO_RESET_DEDUP'});
  stan.magazyn.jev.shadow=true;delete stan.magazyn.jevShadowSeen;
  try {
    const first=await wyslij({typ:'SEMIAUTO_TERAZ'});const calls=stan.zapytaniaAI;
    const second=await wyslij({typ:'SEMIAUTO_TERAZ'});
    assert.equal(first.draftow,0);assert.equal(second.draftow,0);assert.equal(stan.zapytaniaAI,calls);
  }finally{stan.magazyn.jev.shadow=false;}
});

test('zmiana konfiguracji centralnej blokuje stary draft przed zapisem do Gmaila', async()=>{
  const url='https://chat-csa.vercel.app/api/configuration';
  const before=stan.doKarty.filter(x=>x==='WSTRZYKNIJ_DRAFT').length;
  stan.magazyn.centralConnection={enabled:true,url};
  stan.magazyn.centralCache={source:url,document:{schemaVersion:1,revision:2,publishedAt:'2026-09-24T00:00:00Z',catalog:{version:'test',currency:'PLN',approved:false,items:[]},templates:{pl:'{{wycena}} {{dostepnosc}} {{pytania}}',en:'{{wycena}} {{dostepnosc}} {{pytania}}'},availabilityPolicy:{staffing:'unconfirmed',proposals:'unconfirmed',allowFinishAfterClosing:false},replyTemplates:[]}};
  try {
    const result=await wyslij({typ:'JEV_SAVE_DRAFT',tabId:1,threadId:'central-test',messageId:'new',snapshot:'snapshot',text:'Old quote',configurationStamp:url+'#1'});
    assert.equal(result.ok,false);assert.match(result.blad,/Konfiguracja zmieniła/);
    assert.equal(stan.doKarty.filter(x=>x==='WSTRZYKNIJ_DRAFT').length,before);
    assert.equal(stan.magazyn.dedup?.['central-test'],undefined);
  } finally { delete stan.magazyn.centralConnection;delete stan.magazyn.centralCache; }
});
