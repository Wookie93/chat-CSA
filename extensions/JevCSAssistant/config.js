import { activeConfiguration } from './central/schema.mjs';
import { CSA_CATALOG } from './catalog/csa-catalog.js';
import { DEFAULT_TEMPLATES } from './templates/render.js';
import { MODEL } from './ai/jev-client.js';
// config.js — definicje funkcji: etykiety, domyślne modele, prompty systemowe.
// Prompty są edytowalne w options.html; te wartości to tylko punkt startowy / "przywróć domyślne".

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ⚠️ DO UZUPEŁNIENIA: pełny cennik z v1. Dopóki tu jest placeholder,
// "Policz pakiet" będzie zgadywać — patrz README.
export const CENNIK_PLACEHOLDER = `[TU WKLEJ PEŁNY CENNIK CRACOW SHOOTING ACADEMY]
Format sugerowany: nazwa pakietu | co zawiera | liczba strzałów | cena PLN
Dopłaty (instruktor dodatkowy, sprzęt, tarcze, przedłużenie) też tutaj.`;

export const FUNKCJE = {
  pakiet: {
    etykieta: 'Policz pakiet',
    domyslnyModel: 'anthropic/claude-haiku-4.5',
    domyslnyPrompt: `Jesteś asystentem obsługi klienta strzelnicy Cracow Shooting Academy.
Na podstawie treści zapytania klienta policz wycenę pakietu i przedstaw ją zwięźle po polsku.

CENNIK (jedyne dopuszczalne źródło cen — nie wymyślaj pozycji ani kwot spoza niego):
${CENNIK_PLACEHOLDER}

ZASADY:
- Rozbij wycenę na pozycje (co, ile sztuk/osób, cena jednostkowa, suma częściowa) i podaj sumę końcową w PLN.
- Jeśli w zapytaniu brakuje danych (liczba osób, wybrany pakiet, dodatki) — nie zgaduj. Wypisz, czego brakuje.
- Jeśli czegoś nie ma w cenniku, napisz wprost, że pozycji nie ma w cenniku.
- Odpowiadaj po polsku, bez zbędnych wstępów.`,
  },

  tlumacz: {
    etykieta: 'Tłumacz wątek',
    domyslnyModel: 'anthropic/claude-sonnet-4.6',
    domyslnyPrompt: `Jesteś tłumaczem korespondencji mailowej strzelnicy Cracow Shooting Academy.
Dostajesz wiadomości z jednego wątku, ponumerowane, oddzielone znacznikami.

ZASADY:
- Przetłumacz każdą wiadomość na naturalny polski, zachowując podział i numerację wejściową.
- Zachowaj format wyjścia dokładnie taki:
  === WIADOMOŚĆ 1 ===
  <tłumaczenie>
- Wiadomości już napisane po polsku przepisz bez zmian (nie parafrazuj), zachowując ten sam format.
- Nie komentuj, nie streszczaj, nie dodawaj nic od siebie. Zachowaj liczby, daty, godziny, kwoty i nazwy własne 1:1.`,
  },

  semiauto: {
    etykieta: 'Tryb semi-auto (draft odpowiedzi)',
    domyslnyModel: 'anthropic/claude-sonnet-4.6',
    domyslnyPrompt: `Jesteś asystentem obsługi klienta strzelnicy Cracow Shooting Academy.
Piszesz PROJEKT odpowiedzi (draft) na wątek mailowy. Draft trafia do ręcznej weryfikacji człowieka przed wysłaniem.

ZASADY OGÓLNE:
- Pisz w języku, w którym napisał klient (domyślnie polski).
- Ton: uprzejmy, konkretny, bez lania wody. Krótkie akapity. Bez podpisu i bez stopki — dopisze je człowiek.
- Nie obiecuj niczego, czego nie ma w danych poniżej.

DANE O DOSTĘPNOŚCI TERMINÓW:
- Jeżeli poniżej pojawi się blok [DOSTĘPNOŚĆ], zawiera on wynik deterministycznego sprawdzenia kalendarza.
  To jedyne dopuszczalne źródło informacji o wolnych godzinach. NIE ZGADUJ godzin ani dostępności
  i nie podawaj żadnych godzin spoza tego bloku.
- Jeżeli bloku [DOSTĘPNOŚĆ] nie ma (nie udało się ustalić daty), NIE podawaj żadnych konkretnych godzin —
  poproś klienta o doprecyzowanie terminu (data + liczba osób).

CENY:
- Deterministyczna wycena nie jest jeszcze podpięta. Nie podawaj konkretnych kwot ani nie licz pakietów.
  Jeśli klient pyta o cenę, napisz, że wycena zostanie przygotowana, albo poproś o dane potrzebne do wyceny.

Zwróć wyłącznie treść maila — bez nagłówków, bez "Temat:", bez komentarza meta.`,
  },
};

export const DOMYSLNE_USTAWIENIA = {
  centralConnection: { enabled: false, url: '' },
  centralCache: null,
  apiKey: '',
  jev: { model: MODEL, threshold: 0.85, shadow: true, availabilityPolicy: { staffing: 'unconfirmed', proposals: 'unconfirmed', allowFinishAfterClosing: false }, catalog: CSA_CATALOG, templates: DEFAULT_TEMPLATES },
  icalUrl: '',
  modele: {
    pakiet: FUNKCJE.pakiet.domyslnyModel,
    tlumacz: FUNKCJE.tlumacz.domyslnyModel,
    semiauto: FUNKCJE.semiauto.domyslnyModel,
  },
  prompty: {
    pakiet: FUNKCJE.pakiet.domyslnyPrompt,
    tlumacz: FUNKCJE.tlumacz.domyslnyPrompt,
    semiauto: FUNKCJE.semiauto.domyslnyPrompt,
  },
  semiauto: {
    wlaczony: false,
    interwalMin: 7,            // widełki 5–10 min wg spec
    etykieta: '',              // pusta = cała skrzynka odbiorcza
    zapytanieGmail: 'is:unread in:inbox',  // definicja "nowego wątku" — patrz README
    maxWatkowNaCykl: 3,
  },
  tlumacz: {
    pomijajPolskie: false,     // otwarte pytanie #2 ze spec — domyślnie wszystko przez model
  },

  // Wzorzec z zakładki „Wzorce", w który wstawiany jest wynik sprawdzenia dostępności —
  // wskazywany nazwą, bo natywna lista rozwijana nie renderuje się w panelu bocznym.
  // Pusta = pokaż surową notatkę z pipeline'u zamiast maila do klienta.
  dostepnosc: {
    wzorzecNazwa: '',
  },
  icalCacheSek: 3600,          // 47 MB na pobranie — co 5 min było nie do utrzymania, patrz README

  // Weryfikacja pytanego dnia wprost z UI Kalendarza — nadrabia nieświeżość cache'u iCal.
  naZywo: {
    wlaczona: true,
    cacheSek: 180,             // seria maili o ten sam dzień płaci za odczyt raz
    timeoutMs: 12000,          // tyle czekamy na wyrenderowanie chipów (za spec 1.0)
  },
};

/**
 * Klucze, pod którymi trzymane są ustawienia. Odczyt ustawień celuje wyłącznie w nie —
 * `chrome.storage.local.get(null)` ciągnąłby przy okazji cache kalendarza i logi
 * (duże obiekty, niepotrzebne przy każdym odczycie konfiguracji).
 */
export const KLUCZE_USTAWIEN = Object.keys(DOMYSLNE_USTAWIENIA);

/**
 * Wzorce maili siedzą pod własnym kluczem, poza `DOMYSLNE_USTAWIENIA` — z tego samego powodu,
 * co cache kalendarza: to kolekcja, która rośnie z czasem, a ustawienia czytamy przy każdym
 * otwarciu panelu. Kształt wpisu: { id, nazwa, tagi[], tresc, zmieniono }.
 */
export const KLUCZ_WZORCOW = 'wzorce';

/** Scala zapisane ustawienia z domyślnymi (płytko, per sekcja). */
export function zUstawieniami(zapisane = {}) {
  const central = activeConfiguration(zapisane);
  return {
    ...DOMYSLNE_USTAWIENIA,
    ...zapisane,
    jev: { ...DOMYSLNE_USTAWIENIA.jev, ...(zapisane.jev || {}), ...(central ? {catalog:central.catalog,templates:central.templates,availabilityPolicy:central.availabilityPolicy} : {}) },
    modele: { ...DOMYSLNE_USTAWIENIA.modele, ...(zapisane.modele || {}) },
    prompty: { ...DOMYSLNE_USTAWIENIA.prompty, ...(zapisane.prompty || {}) },
    semiauto: { ...DOMYSLNE_USTAWIENIA.semiauto, ...(zapisane.semiauto || {}) },
    tlumacz: { ...DOMYSLNE_USTAWIENIA.tlumacz, ...(zapisane.tlumacz || {}) },
    dostepnosc: { ...DOMYSLNE_USTAWIENIA.dostepnosc, ...(zapisane.dostepnosc || {}) },
    naZywo: { ...DOMYSLNE_USTAWIENIA.naZywo, ...(zapisane.naZywo || {}) },
  };
}
