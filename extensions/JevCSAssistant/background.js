import { configurationStamp } from './central/schema.mjs';
import { decide } from './ai/jev-client.js';
import { calculateAvailability } from './tools/availability.js';
import { REDACTION_PROMPT, restoreBlocks } from './ai/redact.js';
import { analyzeThread, calculateCase } from './core/orchestrator.js';
/**
 * background.js — service worker (MV3, type: module).
 * Odpowiada za: wywołania OpenRouter, fetch prywatnego linku iCal, pipeline dostępności,
 * alarm trybu semi-auto i stan deduplikacji draftów.
 *
 * Sekret (link iCal) nigdy nie jest logowany ani wysyłany gdziekolwiek poza samo żądanie GET.
 */

import { zUstawieniami, OPENROUTER_URL, KLUCZE_USTAWIEN } from './config.js';
import {
  policzDostepnoscZEventow, wykryjDateWTekscie, stworzParserICal,
  kompaktujEventy, odtworzEventy, naISO, polaczNaDzien, klasyfikujEventy,
} from './logic.js';
import { zbierzChipyZeStrony, parsujChipy, urlWidokuDnia, czyWidokDnia } from './kalendarz-dom.js';

const ALARM_SEMIAUTO = 'semiauto';
const ALARM_KALENDARZ = 'kalendarz';
const KLUCZ_DEDUP = 'dedup';
const KLUCZ_LOG = 'logSemiauto';
const MAX_DEDUP = 300;
const MAX_LOG = 50;

// Cache kalendarza: skompaktowane eventy z okna czasowego, nie surowy plik iCal.
const KLUCZ_CACHE = 'icalEventy';
const KLUCZ_CACHE_STARY = 'icalCache';   // ≤2.2.0: trzymał cały plik iCal — patrz uwaga niżej
const KLUCZ_CACHE_DNIA = 'kalendarzDni'; // krótki cache odczytów na żywo, per data
const MAX_DNI_W_CACHE = 8;
// Po nieudanym odczycie na żywo odpuszczamy na chwilę. Bez tego KAŻDE sprawdzenie dostępności
// płaciłoby pełny timeout renderowania (12 s) tylko po to, żeby znów zawieść.
const KLUCZ_BLOKADA_NAZYWO = 'naZywoBlokada';
const BLOKADA_PO_AWARII_MS = 5 * 60e3;
const ODSTEP_ODPYTANIA_MS = 500;
// Ile kolejnych odczytów z tą samą liczbą chipów uznajemy za „widok się ustabilizował".
// Bez tego dzień bez rezerwacji był nieodróżnialny od jeszcze niewyrenderowanego: kosztował
// pełny timeout i zapalał blokadę odczytów na żywo, choć pusty dzień to prawidłowy wynik.
// Ten sam warunek chroni przed odczytaniem dnia renderowanego partiami — połowa chipów
// znaczyłaby „wolne" na slocie, który jest zajęty.
const STABILNYCH_ODCZYTOW = 3;
const OKNO_WSTECZ_DNI = 7;
const OKNO_WPRZOD_DNI = 190;
const MAX_CACHE_BAJTOW = 5_000_000;   // patrz `unlimitedStorage` w manifeście

// Pobranie iCal. Zmierzone na kalendarzu strzelnicy (2026-09): 47,3 MB, ~120 s do ostatniego bajtu.
// Timeout musi mieć zapas nad tym pomiarem, inaczej ucinamy zdrowe pobranie w połowie.
//
// UWAGA na to, co timeout ma obejmować: `fetch` spełnia obietnicę, gdy przyjdą NAGŁÓWKI. Odpowiedź
// idzie chunked, bez `Content-Length`, więc nagłówki są po ułamku sekundy, a te ~120 s to dopiero
// czytanie ciała. Budżet liczony wyłącznie do `fetch` pilnowałby więc czegoś, co nigdy nie trwa
// długo, i zostawiał zawieszony `read()` bez żadnego limitu.
const PROBY_ICAL = 3;

/**
 * Wszystkie limity czasu sieci w jednym miejscu — i jako obiekt, nie osobne stałe, żeby testy
 * mogły je skrócić. Bez tego sprawdzenie „zwisły strumień jest przerywany" musiałoby realnie
 * odczekać minutę, a takiego testu nikt nie uruchamia.
 *
 * `icalBudzet` to łączny czas WSZYSTKICH prób. Chrome ubija service workera, gdy pojedyncze
 * zdarzenie przetwarza się dłużej niż 5 minut, więc 3 × 180 s + przerwy nie zmieściłoby się
 * w platformie: ostatnia próba zostałaby przerwana w połowie, bez żadnego komunikatu.
 */
export const LIMITY = {
  icalProba: 180_000,        // budżet JEDNEJ próby: żądanie + przeczytanie całego strumienia
  icalCisza: 60_000,         // brak choćby jednego bajtu przez tyle = połączenie zwisło
  icalBudzet: 240_000,       // łączny budżet wszystkich prób, z zapasem pod limit 5 min na zdarzenie
  icalMinProby: 20_000,      // poniżej tego nowa próba nie ma szans się udać — nie zaczynamy
  icalPrzerwy: [3_000, 10_000],   // odstępy przed 2. i 3. próbą
  model: 90_000,             // budżet wywołania modelu: żądanie + odczytanie ciała odpowiedzi
  modelPrzerwy: [2_000, 6_000],
  modelMax429: 30_000,       // `Retry-After` bywa liczony w minutach — nie czekamy tyle
};

/**
 * Podtrzymanie service workera na czas długiej operacji sieciowej.
 *
 * Chrome ubija workera po 30 s bezczynności, a licznik resetują WYŁĄCZNIE zdarzenia i wywołania
 * API rozszerzeń („Extension service worker lifecycle"). Czytanie strumienia nie woła ani jednego
 * takiego API, więc ~120 s pobierania kalendarza przekracza to okno czterokrotnie.
 *
 * Najbardziej naraża to odświeżanie z alarmu: `chrome.alarms.onAlarm` nie czeka na wynik, więc
 * zdarzenie kończy się natychmiast, a pobranie leci już poza nim — czyli dokładnie ten mechanizm,
 * dzięki któremu zapytania użytkownika trafiają w ciepły cache, chodzi w trybie najbardziej
 * podatnym na ubicie. Tani no-op co 20 s resetuje licznik bezczynności.
 *
 * Limitu 5 minut na zdarzenie to NIE omija — stąd `LIMITY.icalBudzet` poniżej tej granicy.
 */
function podtrzymajWorkera() {
  const tyka = setInterval(() => {
    try { Promise.resolve(chrome.runtime.getPlatformInfo?.()).catch(() => {}); } catch { /* API niedostępne */ }
  }, 20_000);
  return () => clearInterval(tyka);
}

// Pobranie trwa ~2 min, więc nie może dziać się na oczach użytkownika. Cache odświeżany jest
// alarmem w tle, z zapasem przed wygaśnięciem — zapytanie trafia wtedy zawsze w ciepły cache.
const ZAPAS_ODSWIEZANIA = 0.75;        // odśwież po 75% czasu życia cache'u
const MIN_ODSTEP_ODSWIEZEN_MIN = 15;
// Cache starszy niż TTL, ale młodszy niż to, podajemy od ręki i odświeżamy w tle
// (stale-while-revalidate). Powyżej — blokujemy i czekamy, bo za stary grafik rezerwacji
// to gorsze niż chwila zwłoki.
const MAX_WIEK_AWARYJNY_MS = 6 * 3600e3;

// Kalendarz z wieloletnią historią eksportuje iCal ważący wiele MB. Trzymanie go w całości
// wywalało `chrome.storage.local` na limicie 10 MB (błąd „Resource::kQuotaBytes quota exceeded"),
// a raz zapisany wpis blokował też kolejne zapisy (dedup, log). Stary klucz kasujemy przy każdym
// starcie workera — jest tani w usunięciu i nigdy już nie jest zapisywany.
chrome.storage.local.remove(KLUCZ_CACHE_STARY).catch(() => {});

/* ────────────────────────── Ustawienia / storage ────────────────────────── */

async function ustawienia() {
  const zapisane = await chrome.storage.local.get(KLUCZE_USTAWIEN);
  return zUstawieniami(zapisane);
}

/** Zapis, który nie wywraca funkcji wywołującej — np. gdy storage jest na limicie. */
async function zapiszBezpiecznie(obiekt, opis) {
  try {
    await chrome.storage.local.set(obiekt);
    return true;
  } catch (e) {
    console.warn(`[asystent] Nie udało się zapisać (${opis}): ${e?.message || e}`);
    return false;
  }
}

async function log(poziom, tekst, szczegoly = null) {
  const { [KLUCZ_LOG]: stary = [] } = await chrome.storage.local.get(KLUCZ_LOG);
  const nowy = [{ czas: new Date().toISOString(), poziom, tekst, szczegoly }, ...stary].slice(0, MAX_LOG);
  await zapiszBezpiecznie({ [KLUCZ_LOG]: nowy }, 'log semi-auto');
}

/* ────────────────────────── OpenRouter ────────────────────────── */

// Timeout, bo wiszące żądanie do modelu blokowało cały cykl semi-auto aż do ubicia workera —
// i to bez żadnego śladu w logu. Retry, bo 429 i 5xx z OpenRouter to zwykle chwilowe
// przeciążenie upstreamu, a nie błąd zapytania.
const PROBY_MODELU = 3;

/**
 * Jedno wywołanie: żądanie ORAZ odczytanie ciała odpowiedzi — pod jednym budżetem czasu.
 *
 * Ciało czytamy tutaj, a nie u wołającego, z tego samego powodu, co przy iCal: `fetch` spełnia
 * obietnicę na NAGŁÓWKACH, więc timer skasowany zaraz po nim zostawiał `json()` bez limitu.
 * Model streamuje odpowiedź token po tokenie, więc to właśnie odczyt ciała trwa najdłużej.
 */
async function jednoWywolanieModelu(naglowki, cialo) {
  const stop = new AbortController();
  const budzik = setTimeout(() => stop.abort(), LIMITY.model);
  const koniecPodtrzymania = podtrzymajWorkera();
  try {
    const odp = await fetch(OPENROUTER_URL, { method: 'POST', headers: naglowki, body: cialo, signal: stop.signal });
    if (odp.ok) return { ok: true, status: odp.status, dane: await odp.json() };
    return {
      ok: false,
      status: odp.status,
      tekst: await odp.text().catch(() => ''),
      retryAfter: odp.headers?.get?.('Retry-After') ?? null,
    };
  } catch (e) {
    if (e?.name === 'AbortError') {
      // Nie ponawiamy: powtórka trwałaby tyle samo, a cykl ma do obsłużenia jeszcze inne wątki
      // (ten sam powód, co przy pobieraniu iCal).
      const err = new Error(`Model nie odpowiedział w ${Math.round(LIMITY.model / 1000)} s.`);
      err.ponawialny = false;
      throw err;
    }
    e.ponawialny = true;   // błąd sieci albo ucięte ciało odpowiedzi — warto spróbować jeszcze raz
    throw e;
  } finally {
    clearTimeout(budzik);
    koniecPodtrzymania();
  }
}

/** `Retry-After` w sekundach; wariant z datą i śmieci ignorujemy, zostaje odstęp z tabeli. */
function odczekajZNaglowka(retryAfter, domyslnie) {
  const sekundy = Number(retryAfter);
  if (!Number.isFinite(sekundy) || sekundy <= 0) return domyslnie;
  return Math.min(sekundy * 1000, LIMITY.modelMax429);
}

async function wywolajModel({ funkcja, tresc, promptNadpisany = null, modelNadpisany = null }) {
  const u = await ustawienia();
  if (!u.apiKey) throw new Error('Brak klucza API OpenRouter — uzupełnij w Ustawieniach.');

  const model = modelNadpisany || u.modele[funkcja];
  const system = promptNadpisany || u.prompty[funkcja];
  const naglowki = {
    Authorization: `Bearer ${u.apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'Asystent Klienta CSA',
  };
  const cialo = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: tresc },
    ],
  });

  let ostatni = null;

  for (let proba = 1; proba <= PROBY_MODELU; proba++) {
    if (proba > 1) await poczekaj(ostatni?.odczekaj ?? LIMITY.modelPrzerwy[proba - 2]);

    let odp;
    try {
      odp = await jednoWywolanieModelu(naglowki, cialo);
    } catch (e) {
      if (e?.ponawialny === false) throw e;   // timeout — powtórka nic nie da
      ostatni = e;
      continue;                               // błąd sieci — próbujemy dalej
    }

    if (odp.ok) {
      const wybor = odp.dane?.choices?.[0];
      const wynik = wybor?.message?.content;
      if (!wynik) throw new Error('OpenRouter zwrócił pustą odpowiedź.');
      if (proba > 1) await log('ostrzezenie', `Model odpowiedział dopiero za ${proba}. razem (${ostatni?.message || 'poprzednie próby nieudane'}).`);
      // `finish_reason: 'length'` znaczy, że model urwał się na limicie tokenów. Tekst wygląda
      // na kompletny — bez tej flagi ucięty w pół zdania draft trafiłby do Gmaila jako gotowy.
      return { tekst: wynik, model, uzycie: odp.dane.usage || null, obciety: wybor.finish_reason === 'length' };
    }

    const blad = new Error(`OpenRouter ${odp.status}: ${String(odp.tekst || '').slice(0, 300)}`);
    // Pozostałe 4xx (zły klucz, nieznany model, prompt ponad limit kontekstu) powtórzą się
    // co do joty — ponawiamy wyłącznie przeciążenie.
    if (odp.status !== 429 && odp.status < 500) throw blad;
    blad.odczekaj = odczekajZNaglowka(odp.retryAfter, LIMITY.modelPrzerwy[Math.min(proba - 1, LIMITY.modelPrzerwy.length - 1)]);
    ostatni = blad;
  }

  throw new Error(`Model nie odpowiedział po ${PROBY_MODELU} próbach (${ostatni?.message || 'brak odpowiedzi'}).`);
}

/* ────────────────────────── iCal ────────────────────────── */

function normalizujUrlICal(url) {
  const s = String(url || '').trim();
  if (!s) throw new Error('Brak prywatnego linku iCal — uzupełnij w Ustawieniach.');
  if (s.startsWith('webcal://')) return `https://${s.slice('webcal://'.length)}`;
  if (!/^https?:\/\//i.test(s)) throw new Error('Link iCal musi zaczynać się od https:// lub webcal://');
  return s;
}

function poczekaj(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Czyta odpowiedź kawałek po kawałku prosto do parsera — plik nigdy nie istnieje w całości. */
async function przetworzStrumien(odp, filtr, naBajty = () => {}) {
  const parser = stworzParserICal({ filtr });
  const dekoder = new TextDecoder('utf-8');
  const czytnik = odp.body.getReader();
  let bajtow = 0;

  for (;;) {
    const { done, value } = await czytnik.read();
    if (done) break;
    bajtow += value.byteLength;
    naBajty();   // każdy bajt odracza timeout ciszy
    parser.dodajFragment(dekoder.decode(value, { stream: true }));
  }
  parser.dodajFragment(dekoder.decode());

  return { ...parser.zakoncz(), bajtow };
}

/**
 * Jedna próba: żądanie ORAZ przeczytanie całego strumienia — pod jednym, wspólnym budżetem czasu.
 *
 * Rozdzielenie tych dwóch kroków na osobne funkcje sprawiało, że timer kasował się po nadejściu
 * nagłówków, a właściwe pobieranie (te ~120 s) leciało już bez żadnego limitu — zawieszony
 * `read()` mógł wisieć bez końca. Dlatego oba kroki są tutaj, w jednym `try`/`finally`.
 *
 * Dwa niezależne limity: `budzetMs` na całość i `LIMITY.icalCisza` na przerwę między bajtami.
 * Sam limit całości musi być hojny (zdrowe pobranie naprawdę trwa dwie minuty), więc to timeout
 * ciszy faktycznie wykrywa zwisłe połączenie — i robi to szybciej.
 */
async function jednaProbaICal(url, filtr, budzetMs) {
  const stop = new AbortController();
  const powod = { calosc: false, cisza: false };
  let budzikCiszy = null;

  const budzikCalosci = setTimeout(() => { powod.calosc = true; stop.abort(); }, budzetMs);
  const odrocz = () => {
    clearTimeout(budzikCiszy);
    budzikCiszy = setTimeout(() => { powod.cisza = true; stop.abort(); }, LIMITY.icalCisza);
  };
  odrocz();

  const koniecPodtrzymania = podtrzymajWorkera();

  try {
    const odp = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: stop.signal });
    if (!odp.ok) return { ok: false, status: odp.status };
    odrocz();   // nagłówki przyszły; od teraz liczy się tempo ciała
    return { ok: true, status: odp.status, wynik: await przetworzStrumien(odp, filtr, odrocz) };
  } catch (e) {
    if (e?.name === 'AbortError') {
      if (powod.calosc) {
        // Nie ponawiamy: powtórka trwałaby tyle samo, a budżet workera jest wspólny dla wszystkich prób.
        const err = new Error(`Kalendarz nie oddał całości w ${Math.round(budzetMs / 1000)} s — eksport jest za duży.`);
        err.ponawialny = false;
        throw err;
      }
      // Cisza na łączu bywa chwilowa — to ten sam rodzaj awarii, co urwany strumień, i tak samo warto ponowić.
      const err = new Error(`brak danych przez ${Math.round(LIMITY.icalCisza / 1000)} s — połączenie zwisło`);
      err.ponawialny = true;
      throw err;
    }
    e.ponawialny = true;   // błąd sieci albo urwany strumień — warto spróbować jeszcze raz
    throw e;
  } finally {
    clearTimeout(budzikCalosci);
    clearTimeout(budzikCiszy);
    koniecPodtrzymania();
  }
}

/**
 * Które wydarzenia zatrzymać: okno cache, plus dzień, o który właśnie pytamy, jeśli wypada poza
 * oknem (np. termin na przyszły rok). Bez tego strumieniowanie zgubiłoby daty spoza okna.
 */
function budujFiltr({ od, do: doKiedy, dataISO }) {
  const odMs = od.getTime();
  const doMs = doKiedy.getTime();
  let dodatkowyOd = null;
  let dodatkowyDo = null;

  if (dataISO) {
    const d = new Date(`${dataISO}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      dodatkowyOd = d.getTime();
      dodatkowyDo = dodatkowyOd + 24 * 3600e3;
    }
  }

  return (e) => {
    const s = e.start.getTime();
    const k = e.end.getTime();
    if (k > odMs && s < doMs) return true;
    return dodatkowyOd !== null && k > dodatkowyOd && s < dodatkowyDo;
  };
}

/**
 * Fetch + parsowanie strumieniowe. Surowy tekst iCal nigdzie nie jest materializowany w całości:
 * fragmenty lecą prosto do parsera, który zatrzymuje tylko wydarzenia przechodzące `filtr`.
 *
 * Eksport iCal Google generuje CAŁY kalendarz (nie da się ograniczyć zakresu dat). Przy kalendarzu
 * z wieloletnią historią generowanie przekracza limit czasu po stronie Google i wraca HTTP 500 —
 * stąd retry: wynik eksportu jest po stronie Google cache'owany, więc kolejne podejście zwykle
 * trafia już w gotowy plik. 4xx nie ponawiamy, bo to błąd samego linku.
 */
async function pobierzSurowyICal(url, filtr = null) {
  let ostatni = null;
  const koniecBudzetu = Date.now() + LIMITY.icalBudzet;

  for (let proba = 1; proba <= PROBY_ICAL; proba++) {
    if (proba > 1) await poczekaj(LIMITY.icalPrzerwy[proba - 2]);

    // Każda próba dostaje tyle, ile zostało ze wspólnego budżetu. Bez tego trzy pełne próby
    // przekroczyłyby limit 5 minut na zdarzenie i Chrome ubiłby workera w środku ostatniej.
    const zostalo = Math.min(LIMITY.icalProba, koniecBudzetu - Date.now());
    if (zostalo < LIMITY.icalMinProby) {
      ostatni = ostatni || new Error(`wyczerpany budżet ${Math.round(LIMITY.icalBudzet / 1000)} s`);
      break;
    }

    let proba_;
    try {
      proba_ = await jednaProbaICal(url, filtr, zostalo);
    } catch (e) {
      ostatni = e;
      if (e?.ponawialny === false) throw e;   // budżet wyczerpany — powtórka nic nie da
      continue;                               // błąd sieci, cisza albo urwany strumień — próbujemy dalej
    }

    if (!proba_.ok) {
      if (proba_.status === 404) {
        throw new Error('Kalendarz nie odpowiedział (404) — link iCal jest nieprawidłowy albo został zresetowany.');
      }
      if (proba_.status < 500) {
        throw new Error(`Nie udało się pobrać kalendarza (HTTP ${proba_.status}).`);
      }
      ostatni = new Error(`HTTP ${proba_.status}`);
      continue;
    }

    const wynik = proba_.wynik;
    if (!wynik.otwarty) {
      throw new Error('Pobrana treść nie wygląda na plik iCal (brak BEGIN:VCALENDAR).');
    }
    // Odpowiedź idzie chunked, bez Content-Length, więc urwany strumień wygląda jak sukces.
    // Brak END:VCALENDAR to jedyny sygnał, że plik jest niekompletny — a niekompletny kalendarz
    // znaczy „wolne" na terminie, który jest zajęty. Lepiej błąd niż zła odpowiedź klientowi.
    if (!wynik.zamkniety) {
      ostatni = new Error(`plik urwany po ${Math.round(wynik.bajtow / 1024 / 1024)} MB (brak END:VCALENDAR)`);
      await log('ostrzezenie', `Pobranie kalendarza urwane — ${ostatni.message}, próba ${proba}/${PROBY_ICAL}.`);
      continue;
    }

    if (proba > 1) await log('ostrzezenie', `Kalendarz pobrany dopiero za ${proba}. razem (${ostatni?.message || 'poprzednie próby nieudane'}).`);
    return wynik;
  }

  throw new Error(
    `Nie udało się pobrać kalendarza po ${PROBY_ICAL} próbach (${ostatni?.message || 'brak odpowiedzi'}). ` +
    'Przy błędach 5xx zwykle znaczy to, że eksport iCal tego kalendarza jest dla Google za duży — ' +
    'patrz README, sekcja o dużych kalendarzach.'
  );
}

function przesunODni(znacznik, dni) {
  return new Date(znacznik + dni * 24 * 3600e3);
}

/**
 * Czy zestaw danych z oknem `okno` i ewentualnym dołożonym dniem `dolozonyDzien` niesie datę `szukana`?
 *
 * Wspólne dla cache'u i dla dołączania się do pobrania w locie — te dwa miejsca muszą odpowiadać
 * na to pytanie identycznie, inaczej zaczną się rozjeżdżać przy pierwszej zmianie okna.
 */
function pokrywaDate(okno, dolozonyDzien, szukana) {
  if (!szukana) return true;                                   // bez konkretnej daty liczy się samo okno
  if (dolozonyDzien && szukana === dolozonyDzien) return true;  // dzień dołożony przez filtr strumienia
  return !!okno && szukana > okno.od && szukana < okno.do;
}

/**
 * Pobranie w locie — WSPÓLNE dla wszystkich ścieżek: zapytań, odświeżania w tle i diagnostyki.
 *
 * Wcześniej blokadę miało tylko odświeżanie w tle, więc dwa równoległe sprawdzenia z pustym
 * cache'em (albo sprawdzenie i diagnostyka, albo sprawdzenie i alarm) uruchamiały dwa pełne
 * pobrania po kilkanaście MB. README obiecywał „jedno odświeżanie naraz" — dopiero ten rejestr
 * to obiecanie spełnia.
 */
let trwaPobranie = null;   // { url, dataISO, okno, promise }

/**
 * Świeże pobranie + zapis cache'u. Jedyne miejsce, z którego startuje fetch iCal dla pipeline'u.
 */
function swiezePobranie(url, dataISO) {
  const teraz = Date.now();
  const od = przesunODni(teraz, -OKNO_WSTECZ_DNI);
  const doKiedy = przesunODni(teraz, OKNO_WPRZOD_DNI);
  const okno = { od: naISO(od), do: naISO(doKiedy) };

  // Dołączamy się do pobrania w locie TYLKO wtedy, gdy jego filtr obejmuje naszą datę.
  // Filtr strumienia przepuszcza okno plus jeden dołożony dzień, więc pobranie uruchomione
  // dla terminu za dwa lata odsiało wszystkie pozostałe daty spoza okna — podpięcie się pod nie
  // zwróciłoby „brak wydarzeń" dla dnia, który po prostu nie przeszedł filtra. Czyli „wolne"
  // na terminie, który może być zajęty: dokładnie ten błąd, którego ten kod ma unikać.
  if (trwaPobranie && trwaPobranie.url === url
      && pokrywaDate(trwaPobranie.okno, trwaPobranie.dataISO, dataISO)) {
    return trwaPobranie.promise;
  }

  // Wpis do rejestru trafia PRZED uruchomieniem pobrania, żeby `finally` miało co posprzątać
  // także wtedy, gdy ciało wywali się synchronicznie.
  const wpisRejestru = { url, dataISO, okno, promise: null };
  trwaPobranie = wpisRejestru;

  wpisRejestru.promise = (async () => {
    try {
      const pobrane = await pobierzSurowyICal(url, budujFiltr({ od, do: doKiedy, dataISO }));
      const wszystkie = pobrane.eventy;
      const kompaktne = kompaktujEventy(wszystkie, { od, do: doKiedy });

      const wpis = { url, czas: teraz, okno, eventy: kompaktne };
      const bajtow = JSON.stringify(wpis).length;
      if (bajtow <= MAX_CACHE_BAJTOW) {
        await zapiszBezpiecznie({ [KLUCZ_CACHE]: wpis }, 'cache kalendarza');
      } else {
        // Skrajnie gęsty kalendarz — liczymy dalej na świeżych danych, tylko bez cache.
        await chrome.storage.local.remove(KLUCZ_CACHE).catch(() => {});
        await log('ostrzezenie', `Cache kalendarza pominięty — okno ma ${Math.round(bajtow / 1024)} kB (limit ${Math.round(MAX_CACHE_BAJTOW / 1024)} kB).`);
      }

      // Świeże pobranie liczymy na komplecie eventów, żeby daty spoza okna cache też działały.
      return {
        eventy: wszystkie,
        zCache: false,
        czas: teraz,
        wOknie: kompaktne.length,
        wszystkich: pobrane.wszystkich,
        zachowanych: wszystkie.length,
        bajtowICal: pobrane.bajtow,
        bajtowCache: bajtow,
      };
    } finally {
      // Tylko własny wpis — pobranie o innym pokryciu dat mogło już zająć rejestr.
      if (trwaPobranie === wpisRejestru) trwaPobranie = null;
    }
  })();

  return wpisRejestru.promise;
}

/**
 * Eventy z kalendarza, z krótkim cache, żeby cykl semi-auto nie odpytywał Google przy każdym wątku.
 * Cache trzyma wyłącznie skompaktowane eventy z okna [-7 dni, +190 dni] — patrz KLUCZ_CACHE wyżej.
 * Data spoza tego okna (np. termin na przyszły rok) omija cache i liczy się na świeżym, pełnym pobraniu.
 */
async function pobierzEventy({ pomijCache = false, dataISO = null } = {}) {
  const u = await ustawienia();
  const url = normalizujUrlICal(u.icalUrl);
  const teraz = Date.now();

  if (!pomijCache && dataISO) {
    const { [KLUCZ_CACHE]: cache } = await chrome.storage.local.get(KLUCZ_CACHE);
    // Cache trzyma wyłącznie okno — nigdy dnia dołożonego przez filtr strumienia.
    const uzyteczny = cache && cache.url === url && pokrywaDate(cache.okno, null, dataISO);

    if (uzyteczny) {
      const wiek = teraz - cache.czas;
      const swiezy = wiek < u.icalCacheSek * 1000;

      // Świeży — albo przeterminowany, ale na tyle niedawny, że lepiej odpowiedzieć teraz
      // i dociągnąć w tle, niż kazać użytkownikowi czekać dwie minuty przy kliencie na linii.
      if (swiezy || wiek < MAX_WIEK_AWARYJNY_MS) {
        if (!swiezy) odswiezWTle('cache przeterminowany przy zapytaniu');
        return {
          eventy: odtworzEventy(cache.eventy),
          zCache: true,
          czas: cache.czas,
          wOknie: cache.eventy.length,
          przeterminowany: !swiezy,
          wiekMs: wiek,
        };
      }
    }
  }

  return swiezePobranie(url, dataISO);
}

/* ────────────────────── Kalendarz na żywo (jeden dzień z DOM-u) ────────────────────── */

/** Własna karta w tle: odczyt nie przełącza istniejącego kalendarza użytkownika. */
async function kartaKalendarza(dataISO) {
  const karta = await chrome.tabs.create({ url: urlWidokuDnia(dataISO), active: false });
  return { id: karta.id, nasza: true };
}

/**
 * Jeden dzień prosto z UI Kalendarza.
 *
 * Zwraca `{ eventy }` po udanym odczycie — pusta tablica znaczy „tego dnia nic nie ma"
 * i jest prawidłowym wynikiem, nie awarią. Przy niepowodzeniu `{ eventy: null, powod }`;
 * to ścieżka pomocnicza i nie ma prawa wywrócić sprawdzania dostępności, więc wołający
 * liczy wtedy z iCal, a `powod` idzie do logu, żeby dało się to zdiagnozować.
 */
async function czytajDzienZDOM(dataISO, timeoutMs) {
  let karta = null;
  try {
    karta = await kartaKalendarza(dataISO);
    const koniec = Date.now() + timeoutMs;
    let poprzednia = -1;
    let stabilnych = 0;

    // Nawigacja `chrome.tabs.update` bywa pełnym przeładowaniem aplikacji Kalendarza,
    // stąd odpytywanie w pętli zamiast pojedynczego strzału (ten sam powód, co w spec 1.0).
    while (Date.now() < koniec) {
      let wynik;
      try {
        [wynik] = await chrome.scripting.executeScript({
          target: { tabId: karta.id },
          func: zbierzChipyZeStrony,
        });
      } catch {
        // Brak dostępu do karty (zamknięta, wylogowany, brak uprawnień) — odczekiwanie
        // pełnego timeoutu niczego nie zmieni. Wychodzimy od razu.
        return { eventy: null, powod: 'brak dostępu do karty Kalendarza' };
      }

      const odczyt = wynik?.result;
      const chipy = odczyt?.chipy;

      // Chipy liczymy dopiero, gdy Kalendarz faktycznie stoi na pytanym dniu, i dopiero gdy
      // ich liczba przestanie się zmieniać. Dwa różne błędy, które to zatrzymuje: odczyt
      // poprzedniego widoku i odczyt widoku w połowie renderowania.
      if (Array.isArray(chipy) && czyWidokDnia(odczyt.sciezka, dataISO)) {
        stabilnych = chipy.length === poprzednia ? stabilnych + 1 : 1;
        poprzednia = chipy.length;
        if (stabilnych >= STABILNYCH_ODCZYTOW) return { eventy: parsujChipy(chipy, dataISO) };
      } else {
        poprzednia = -1;
        stabilnych = 0;
      }
      await poczekaj(ODSTEP_ODPYTANIA_MS);
    }

    const sekundy = Math.round(timeoutMs / 1000);
    return {
      eventy: null,
      powod: poprzednia === -1
        ? `Kalendarz nie otworzył widoku dnia ${dataISO} w ${sekundy} s`
        : `widok dnia ${dataISO} nie ustabilizował się w ${sekundy} s`,
    };
  } catch (e) {
    return { eventy: null, powod: e?.message || 'nieznany błąd odczytu' };
  } finally {
    if (karta?.nasza) await chrome.tabs.remove(karta.id).catch(() => {});
  }
}

/** Odczyt na żywo z krótkim cache'em per data — seria maili o ten sam dzień płaci raz. */
async function eventyDniaNaZywo(dataISO, u) {
  if (!u.naZywo?.wlaczona) return null;

  const teraz = Date.now();
  const magazyn = await chrome.storage.local.get([KLUCZ_CACHE_DNIA, KLUCZ_BLOKADA_NAZYWO]);
  const cache = magazyn[KLUCZ_CACHE_DNIA] || {};

  const wpis = cache[dataISO];
  if (wpis && teraz - wpis.czas < u.naZywo.cacheSek * 1000) {
    return odtworzEventy(wpis.eventy);
  }

  // Świeżo po nieudanym odczycie nie próbujemy ponownie — liczymy z iCal bez zwłoki.
  if (magazyn[KLUCZ_BLOKADA_NAZYWO] > teraz) return null;

  const { eventy, powod } = await czytajDzienZDOM(dataISO, u.naZywo.timeoutMs);
  if (!eventy) {
    await zapiszBezpiecznie({ [KLUCZ_BLOKADA_NAZYWO]: teraz + BLOKADA_PO_AWARII_MS }, 'blokada odczytu na żywo');
    await log('ostrzezenie',
      `Nie udało się odczytać Kalendarza dla ${dataISO} (${powod}) — dostępność liczona z iCal. ` +
      `Kolejne próby wstrzymane na ${Math.round(BLOKADA_PO_AWARII_MS / 60000)} min.`);
    return null;
  }
  await chrome.storage.local.remove(KLUCZ_BLOKADA_NAZYWO).catch(() => {});

  // Trzymamy tylko kilka ostatnich dat — to cache podręczny, nie archiwum.
  const swiezy = { ...cache, [dataISO]: { czas: teraz, eventy: kompaktujEventy(eventy, {}) } };
  const daty = Object.keys(swiezy).sort((a, b) => swiezy[b].czas - swiezy[a].czas);
  for (const d of daty.slice(MAX_DNI_W_CACHE)) delete swiezy[d];
  await zapiszBezpiecznie({ [KLUCZ_CACHE_DNIA]: swiezy }, 'cache dnia');

  return eventy;
}

/** Pełny pipeline 5.2 — jedyne wejście dla panelu i dla trybu semi-auto. */
async function sprawdzDostepnosc({ dataISO, osoby, czasTrwaniaMin, preferowanaGodzina, pomijCache }) {
  const u = await ustawienia();
  const { eventy, zCache, czas, przeterminowany = false } = await pobierzEventy({ pomijCache, dataISO });

  // iCal daje bazę dla wszystkich dat; pytany dzień, jeśli się da, nadpisujemy odczytem na żywo.
  let uzyte = eventy;
  let dzienNaZywo = false;
  const zDnia = await eventyDniaNaZywo(dataISO, u);
  if (zDnia) {
    uzyte = polaczNaDzien(eventy, zDnia, dataISO);
    dzienNaZywo = true;
  }

  const wynik = calculateAvailability({ eventy: uzyte, dataISO, osoby, czasTrwaniaMin, preferowanaGodzina }, u.jev.availabilityPolicy);
  return {
    ...wynik,
    zrodlo: {
      zCache,
      przeterminowany,          // baza z cache'u po TTL; świeże dane lecą w tle
      dzienNaZywo,              // pytany dzień potwierdzony wprost z Kalendarza
      wiekMin: Math.round((Date.now() - czas) / 60000),
      pobrano: new Date(czas).toISOString(),
    },
  };
}

/* ────────────────────────── Deduplikacja draftów (5.4 pkt 3 i 7) ────────────────────────── */

/**
 * Stany wpisu:
 *   'wToku'  — zaczęliśmy przygotowywać draft dla tej wiadomości i NIE WIEMY, czy trafił do Gmaila.
 *   'gotowe' — draft został wstrzyknięty i potwierdzony.
 *
 * Rozróżnienie istnieje dla jednego przypadku: worker ubity między wstrzyknięciem draftu
 * a zapisem stanu. Wpis zapisywany dopiero po wstrzyknięciu znaczył, że następny cykl uznawał
 * wątek za nowy i wstrzykiwał drugi draft — nadpisując pierwszy, razem z ręcznymi poprawkami.
 *
 * Wpisy sprzed 2.3.0 nie mają pola `stan`; wszystkie powstawały po udanym wstrzyknięciu,
 * więc czytamy je jako 'gotowe'.
 */
const STAN_W_TOKU = 'wToku';
const STAN_GOTOWE = 'gotowe';

const stanWpisu = (wpis) => wpis?.stan || STAN_GOTOWE;

async function mapaDedup() {
  const { [KLUCZ_DEDUP]: mapa = {} } = await chrome.storage.local.get(KLUCZ_DEDUP);
  return mapa;
}

async function zapiszDedup(threadId, messageId, stan) {
  const mapa = await mapaDedup();
  mapa[threadId] = { messageId, czas: Date.now(), stan };
  const klucze = Object.keys(mapa).sort((a, b) => (mapa[b].czas || 0) - (mapa[a].czas || 0));
  const przyciety = Object.fromEntries(klucze.slice(0, MAX_DEDUP).map((k) => [k, mapa[k]]));
  if (!await zapiszBezpiecznie({ [KLUCZ_DEDUP]: przyciety }, 'mapa deduplikacji')) throw new Error('Nie zapisano blokady draftu — przerwano, aby uniknąć duplikatu.');
}

/**
 * Zdejmuje znacznik „w toku" po błędzie, o którym wiemy (model odmówił, wstrzyknięcie nie
 * przeszło). Wątek ma wtedy wrócić w następnym cyklu. Wpis 'gotowe' zostaje nietknięty —
 * draft mógł się udać, a wywrócić dopiero powrót do listy.
 */
async function zwolnijDedup(threadId) {
  const mapa = await mapaDedup();
  if (stanWpisu(mapa[threadId]) !== STAN_W_TOKU) return;
  delete mapa[threadId];
  await zapiszBezpiecznie({ [KLUCZ_DEDUP]: mapa }, 'zwolnienie wpisu deduplikacji');
}

// Serialize all new-flow draft writes, including manual panel and semi-auto.
let kolejkaDraftow = Promise.resolve();
function zapiszDraftJev(request) {
  const operation = kolejkaDraftow.then(async () => {
    const { tabId, threadId, messageId, text, snapshot } = request;
    if (!Number.isInteger(tabId) || !threadId || !messageId || !snapshot || typeof text !== 'string' || !text.trim() || text.length>50000) throw new Error('Niepełne dane draftu. Wczytaj aktualny wątek.');
    const stamp=configurationStamp(await ustawienia());
    if ((request.configurationStamp || 'local') !== stamp) throw new Error('Konfiguracja zmieniła się. Przelicz odpowiedź przed zapisaniem draftu.');
    const existing = (await mapaDedup())[threadId];
    if (existing?.messageId === messageId) throw new Error('Ten wątek ma już przygotowany lub niepotwierdzony draft. Sprawdź Gmail.');
    await zapiszDedup(threadId,messageId,STAN_W_TOKU);
    let uncertain = false;
    try {
      uncertain = true;
      const response = await wyslijDoKarty(tabId, { typ:'WSTRZYKNIJ_DRAFT', tekst:text, guarded:true, expectedSnapshot:snapshot },40000);
      if (!response?.ok) { uncertain = false; throw new Error(response?.blad || 'Nie wstawiono draftu.'); }
      await zapiszDedup(threadId,messageId,STAN_GOTOWE);
    } catch(e) {
      if (!uncertain) await zwolnijDedup(threadId);
      throw e;
    }
  });
  kolejkaDraftow = operation.catch(() => {});
  return operation;
}

/* ────────────────────────── Tryb semi-auto ────────────────────────── */

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));

function wyslijDoKarty(tabId, wiadomosc, timeoutMs = 30000) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, wiadomosc),
    czekaj(timeoutMs).then(() => { throw new Error(`Karta nie odpowiedziała na ${wiadomosc.typ}.`); }),
  ]);
}

async function czekajNaContentScript(tabId, timeoutMs = 25000) {
  const doKiedy = Date.now() + timeoutMs;
  while (Date.now() < doKiedy) {
    try {
      const odp = await chrome.tabs.sendMessage(tabId, { typ: 'PING' });
      if (odp?.gotowy) return true;
    } catch { /* content script jeszcze się nie wstrzyknął */ }
    await czekaj(500);
  }
  return false;
}

function urlWyszukiwania(zapytanie, etykieta) {
  const pelne = etykieta ? `label:${etykieta.replace(/\s+/g, '-')} ${zapytanie}` : zapytanie;
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(pelne)}`;
}

let aktywnyCykl = null;
function cyklSemiauto(options = {}) {
  if (aktywnyCykl) return aktywnyCykl;
  const stop = podtrzymajWorkera();
  aktywnyCykl = wykonajCyklSemiauto(options).finally(() => { stop(); aktywnyCykl = null; });
  return aktywnyCykl;
}
async function wykonajCyklSemiauto({ reczny = false } = {}) {
  const u = await ustawienia();
  if (!u.semiauto.wlaczony && !reczny) return { ok: false, powod: 'Tryb semi-auto wyłączony.' };
  if (!u.apiKey) { await log('blad', 'Cykl przerwany: brak klucza API.'); return { ok: false, powod: 'Brak klucza API.' }; }

  const podsumowanie = { sprawdzone: 0, pominieteDedup: 0, przerwane: 0, draftow: 0, bledy: [] };
  let tab = null;

  try {
    tab = await chrome.tabs.create({
      url: urlWyszukiwania(u.semiauto.zapytanieGmail, u.semiauto.etykieta),
      active: false,
    });
    if (!(await czekajNaContentScript(tab.id))) throw new Error('Content script nie odpowiedział w karcie Gmaila.');
    await czekaj(2500); // Gmail dociąga listę wyników wyszukiwania

    const lista = await wyslijDoKarty(tab.id, { typ: 'SKANUJ_LISTE', opcje: { tylkoNieprzeczytane: false } });
    if (!lista?.ok) throw new Error(lista?.blad || 'Nie udało się odczytać listy wątków.');

    const dedup = await mapaDedup();
    const kandydaci = lista.watki.slice(0, u.semiauto.maxWatkowNaCykl);

    for (const w of kandydaci) {
      podsumowanie.sprawdzone++;
      let oznaczony = null;      // wątek z zapisanym znacznikiem „w toku" w tej iteracji
      let wynikNieznany = false; // czy draft mógł już trafić do Gmaila mimo błędu
      try {
        const otwarty = await wyslijDoKarty(tab.id, { typ: 'OTWORZ_WATEK', watek: w });
        if (!otwarty?.ok) throw new Error(otwarty?.blad || 'Nie udało się otworzyć wątku.');
        const watek = otwarty.dane;
        const threadId = watek.threadId || w.threadId;
        const ostatniaId = watek.ostatniaWiadomoscId;

        // Deduplikacja stoi na tych dwóch identyfikatorach. Bez stabilnego ID nie da się odróżnić
        // „ten sam wątek co poprzednio" od „przyszła nowa wiadomość", więc automat musi się zatrzymać:
        // zgadywanie kończy się albo drugim draftem na tym samym wątku, albo trwałym pominięciem wątku.
        if (!threadId || !ostatniaId) {
          throw new Error('Brak stabilnego identyfikatora wątku lub ostatniej wiadomości — ' +
            'deduplikacja nie miałaby na czym stanąć. Najczęstsza przyczyna: zmiana selektorów Gmaila.');
        }

        // Automat pracuje na tym, co widać w DOM-ie. Zwinięta część wątku znaczy niepełny kontekst
        // dla modelu — draft nadal idzie do człowieka, ale niech będzie wiadomo, na czym powstał.
        for (const o of watek.ostrzezenia || []) {
          await log('ostrzezenie', `Wątek „${watek.tytul || w.temat || threadId}": ${o}`);
        }

        const wpis = dedup[threadId];
        if (wpis?.messageId === ostatniaId) {
          // 'wToku' = poprzedni cykl urwał się po wywołaniu modelu, a przed potwierdzeniem draftu.
          // Nie wiemy, czy Gmail go dostał, a ponowne wstrzyknięcie nadpisałoby to, co mógł już
          // poprawić człowiek — więc wątek zostawiamy i mówimy o tym wprost zamiast po cichu pominąć.
          if (stanWpisu(wpis) === STAN_W_TOKU) {
            podsumowanie.przerwane++;
            await log('ostrzezenie',
              `Wątek „${w.temat || threadId}" pominięty — poprzedni cykl przerwano w trakcie przygotowywania draftu. ` +
              'Sprawdź wersje robocze w Gmailu; „Wyczyść dedup" pozwoli spróbować ponownie.');
          } else {
            podsumowanie.pominieteDedup++;
          }
          await wyslijDoKarty(tab.id, { typ: 'WROC_DO_LISTY' });
          continue;
        }

        const signatureBytes = new TextEncoder().encode(JSON.stringify([watek, u.jev, 'pipeline-v1']));
        const signature = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', signatureBytes)), b => b.toString(16).padStart(2, '0')).join('');
        const shadowSeen = (await chrome.storage.local.get('jevShadowSeen')).jevShadowSeen || {};
        if (u.jev.shadow && shadowSeen[signature]) {
          await wyslijDoKarty(tab.id, { typ: 'WROC_DO_LISTY' });
          continue;
        }
        const analysis = await analyzeThread({ thread: watek, settings: u });
        const caseResult = await calculateCase(analysis, u, sprawdzDostepnosc);
        await chrome.storage.local.set({ jevLastMetrics: { at: Date.now(), metrics: caseResult.metrics,
          needsReview: caseResult.needsReview, missing: caseResult.missing } });
        if (u.jev.shadow) {
          const entries = [...Object.entries(shadowSeen), [signature, Date.now()]].sort((a,b) => b[1]-a[1]).slice(0,300);
          await chrome.storage.local.set({ jevShadowSeen: Object.fromEntries(entries) });
        }
        if (u.jev.shadow || !caseResult.draft) {
          await log('info', u.jev.shadow ? 'Jev: tryb porównawczy, bez draftu.' : 'Jev: sprawa wymaga ręcznego sprawdzenia.');
          await wyslijDoKarty(tab.id, { typ: 'WROC_DO_LISTY' });
          continue;
        }
        const dostepnoscMeta = caseResult.availability;

        const odp = { tekst: caseResult.draft.text, model: u.jev.model };
        await zapiszDraftJev({ tabId: tab.id, threadId, messageId: ostatniaId, text: odp.tekst, snapshot: analysis.snapshot, configurationStamp: caseResult.configurationStamp });
        dedup[threadId] = { messageId: ostatniaId, czas: Date.now(), stan: STAN_GOTOWE };
        podsumowanie.draftow++;
        await log('info', `Draft przygotowany: „${watek.tytul || w.temat || threadId}"`, {
          threadId, dostepnosc: dostepnoscMeta, model: odp.model,
        });

        await czekaj(1500); // daj Gmailowi zapisać wersję roboczą
        await wyslijDoKarty(tab.id, { typ: 'WROC_DO_LISTY' });
      } catch (e) {
        // Błąd, o którym wiemy — zdejmujemy znacznik, żeby wątek wrócił w następnym cyklu.
        // „W toku" ma zostać wyłącznie tam, gdzie wyniku naprawdę nie znamy: ubity worker
        // albo karta, która nie potwierdziła wstrzyknięcia.
        if (oznaczony && !wynikNieznany) {
          await zwolnijDedup(oznaczony);
          delete dedup[oznaczony];
        }
        podsumowanie.bledy.push(`${w.temat || w.threadId}: ${e.message}`);
        await log('blad', `Wątek pominięty: ${e.message}`, { temat: w.temat });
        try { await wyslijDoKarty(tab.id, { typ: 'WROC_DO_LISTY' }); } catch { /* karta i tak zostanie zamknięta */ }
      }
    }
  } catch (e) {
    podsumowanie.bledy.push(e.message);
    await log('blad', `Cykl semi-auto przerwany: ${e.message}`);
  } finally {
    if (tab?.id) { try { await chrome.tabs.remove(tab.id); } catch { /* karta mogła już zniknąć */ } }
  }

  await zapiszBezpiecznie({ ostatniCykl: { czas: Date.now(), ...podsumowanie } }, 'podsumowanie cyklu');
  return { ok: true, ...podsumowanie };
}

/* ────────────────────────── Alarmy ────────────────────────── */

// Samo pobranie jest już współdzielone przez rejestr `trwaPobranie` — ten strażnik pilnuje tylko,
// żeby alarm i stale-while-revalidate trafiające w ten sam moment nie dopisały dwóch identycznych
// wpisów do logu.
let trwaOdswiezanie = null;

function odswiezWTle(powod) {
  if (trwaOdswiezanie) return trwaOdswiezanie;

  trwaOdswiezanie = (async () => {
    const start = Date.now();
    try {
      const r = await pobierzEventy({ pomijCache: true });
      await log('info',
        `Cache kalendarza odświeżony w tle (${powod}) — ${r.wOknie} wydarzeń z ${r.wszystkich}, ` +
        `${Math.round(r.bajtowICal / 1024 / 1024)} MB w ${Math.round((Date.now() - start) / 1000)} s.`);
    } catch (e) {
      await log('blad', `Odświeżanie kalendarza w tle nie powiodło się (${powod}): ${e?.message || e}`);
    } finally {
      trwaOdswiezanie = null;
    }
  })();

  return trwaOdswiezanie;
}

async function przeladujAlarm() {
  const u = await ustawienia();

  // Kalendarz odświeżamy niezależnie od trybu semi-auto — to on decyduje o tym,
  // czy „Sprawdź dostępność" odpowiada natychmiast, czy po dwóch minutach.
  await chrome.alarms.clear(ALARM_KALENDARZ);
  if (u.icalUrl && u.icalCacheSek > 0) {
    const minuty = Math.max(
      MIN_ODSTEP_ODSWIEZEN_MIN,
      Math.round((u.icalCacheSek * ZAPAS_ODSWIEZANIA) / 60)
    );
    await chrome.alarms.create(ALARM_KALENDARZ, { periodInMinutes: minuty, delayInMinutes: 1 });
    await log('info', `Cache kalendarza odświeżany w tle co ${minuty} min.`);
  }

  await chrome.alarms.clear(ALARM_SEMIAUTO);
  if (!u.semiauto.wlaczony) return;
  const minuty = Math.min(10, Math.max(5, Number(u.semiauto.interwalMin) || 7));
  await chrome.alarms.create(ALARM_SEMIAUTO, { periodInMinutes: minuty, delayInMinutes: 1 });
  await log('info', `Tryb semi-auto włączony — cykl co ${minuty} min.`);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SEMIAUTO) cyklSemiauto();
  if (alarm.name === ALARM_KALENDARZ) odswiezWTle('alarm');
});

// Kliknięcie ikony rozszerzenia otwiera panel boczny (ustawiane przy każdym starcie workera).
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => przeladujAlarm());
chrome.runtime.onStartup.addListener(() => przeladujAlarm());

chrome.storage.onChanged.addListener((zmiany, obszar) => {
  if (obszar === 'local' && (zmiany.semiauto || zmiany.icalUrl || zmiany.icalCacheSek)) przeladujAlarm();
});

/* ────────────────────────── Router wiadomości ────────────────────────── */

chrome.runtime.onMessage.addListener((msg, _nadawca, odpowiedz) => {
  (async () => {
    try {
      switch (msg?.typ) {
        case 'JEV_TEST': {
          const u=await ustawienia();
          const r=await decide({apiKey:u.apiKey,model:u.jev.model,state:{message:'Hello'},questions:{language:{type:'choice',instructions:'Which language is this greeting in?',criteria:{en:'English',pl:'Polish',other:'Other'}}}});
          if(r.answers.language.choice!=='en') throw new Error('API odpowiedziało, ale wynik próby jest nieprawidłowy.');
          odpowiedz({ok:true,metrics:r.metrics});
          break;
        }
        case 'JEV_SAVE_DRAFT': {
          await zapiszDraftJev(msg);
          odpowiedz({ok:true});
          break;
        }
        case 'JEV_REDACT': {
          if (!['pl','en'].includes(msg.language) || typeof msg.text !== 'string' || msg.text.length > 20000) throw new Error('Nieprawidłowa odpowiedź do redakcji.');
          const r = await wywolajModel({ funkcja: 'semiauto', tresc: `Language: ${msg.language}. Marker: [[VERIFIED_REPLY]]`, promptNadpisany: REDACTION_PROMPT });
          if (r.obciety) throw new Error('LLM urwał odpowiedź. Zachowano wzorzec.');
          odpowiedz({ ok: true, text: restoreBlocks(r.tekst, msg.text), usage: r.uzycie });
          break;
        }
        case 'JEV_ANALYZE': {
          const u = await ustawienia();
          const stop = podtrzymajWorkera();
          try {
            const analysis = await analyzeThread({ thread: msg.thread, settings: u });
            const result = await calculateCase(analysis, u, sprawdzDostepnosc);
            odpowiedz({ ok: true, result });
          } finally { stop(); }
          break;
        }
        case 'JEV_RECALCULATE': {
          const u = await ustawienia();
          const result = await calculateCase(msg.case, u, sprawdzDostepnosc);
          odpowiedz({ ok: true, result });
          break;
        }
        case 'AI': {
          if (msg.funkcja === 'pakiet') {
            const u = await ustawienia();
            const analysis = await analyzeThread({ thread: { wiadomosci: [{ tekst: msg.tresc }] }, settings: u });
            const result = await calculateCase(analysis, u, sprawdzDostepnosc);
            odpowiedz({ ok: true, tekst: result.draft?.text || `Do sprawdzenia: ${[...result.issues, ...result.missing].join(', ')}`, result });
            break;
          }
          const wynik = await wywolajModel(msg);
          odpowiedz({ ok: true, ...wynik });
          break;
        }
        case 'DOSTEPNOSC': {
          const wynik = await sprawdzDostepnosc(msg);
          odpowiedz({ ok: true, wynik });
          break;
        }
        case 'ICAL_DIAGNOSTYKA': {
          // Narzędzie dev (otwarte pytanie #3 ze spec) — debug fetcha/parsera iCal zamiast DOM-u Kalendarza.
          //
          // Idzie przez `pobierzEventy`, a nie wprost do `pobierzSurowyICal`, z dwóch powodów:
          // dołącza się wtedy do pobrania już trwającego (zamiast ciągnąć drugie równolegle)
          // i zapisuje cache — wcześniej „Testuj link iCal" ściągał kilkanaście MB, budował raport
          // i wyrzucał dane, więc pierwsze sprawdzenie dostępności pobierało wszystko od nowa.
          // `pomijCache` zostaje: diagnostyka ma testować link, więc nie może odpowiadać z cache'u.
          const r = await pobierzEventy({ pomijCache: true });
          const eventy = r.eventy;
          const bajtowCache = r.bajtowCache;
          const dzis = naISO(new Date());
          odpowiedz({
            ok: true,
            raport: {
              bajtow: r.bajtowICal,
              eventow: r.wszystkich,
              wOknie: r.zachowanych,
              cykliczne: eventy.filter((e) => e.cykliczne).length,
              calodniowe: eventy.filter((e) => e.calodniowe).length,
              bezStrefy: eventy.filter((e) => !e.tzid).length,
              // Obsada instruktorów: bez tych wpisów dostępność zawsze wyjdzie „brak miejsc".
              obsady: klasyfikujEventy(eventy).filter((e) => e.typ === 'obsada').length,
              odDzisiaj: eventy.filter((e) => naISO(e.start) >= dzis).length,
              wOknieCache: r.wOknie,
              bajtowCache,
              cacheZapisany: bajtowCache <= MAX_CACHE_BAJTOW,
              oknoDni: [OKNO_WSTECZ_DNI, OKNO_WPRZOD_DNI],
              zCache: false,
              pobrano: new Date(r.czas).toISOString(),
              probka: eventy
                .slice()
                .sort((a, b) => a.start - b.start)
                .filter((e) => naISO(e.start) >= dzis)
                .slice(0, 10)
                .map((e) => ({ start: e.start.toISOString(), end: e.end.toISOString(), tytul: e.tytul, cykliczne: e.cykliczne })),
            },
          });
          break;
        }
        case 'SEMIAUTO_TERAZ':
          odpowiedz(await cyklSemiauto({ reczny: true }));
          break;
        case 'SEMIAUTO_STATUS': {
          const [alarm, dane] = await Promise.all([
            chrome.alarms.get(ALARM_SEMIAUTO),
            chrome.storage.local.get(['ostatniCykl', KLUCZ_DEDUP, KLUCZ_LOG]),
          ]);
          odpowiedz({
            ok: true,
            alarm: alarm ? { nastepny: alarm.scheduledTime, interwal: alarm.periodInMinutes } : null,
            ostatniCykl: dane.ostatniCykl || null,
            watkowWDedup: Object.keys(dane[KLUCZ_DEDUP] || {}).length,
            log: (dane[KLUCZ_LOG] || []).slice(0, 15),
          });
          break;
        }
        case 'SEMIAUTO_RESET_DEDUP':
          await zapiszBezpiecznie({ [KLUCZ_DEDUP]: {} }, 'reset deduplikacji');
          odpowiedz({ ok: true });
          break;
        case 'WYCZYSC_CACHE_ICAL':
          await chrome.storage.local.remove([KLUCZ_CACHE, KLUCZ_CACHE_STARY]).catch(() => {});
          odpowiedz({ ok: true });
          break;
        default:
          odpowiedz({ ok: false, blad: `Nieznany typ wiadomości: ${msg?.typ}` });
      }
    } catch (e) {
      odpowiedz({ ok: false, blad: String(e && e.message ? e.message : e) });
    }
  })();
  return true;
});
