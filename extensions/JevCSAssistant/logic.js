// logic.js — czysta logika biznesowa (bez UI, bez AI, bez chrome.*).
// Testowalna w Node: `node --test test/logic.test.mjs`
//
// UWAGA DO KONFIGURACJI (patrz README, sekcja "Do uzupełnienia z v1"):
// stałe w KONFIG poniżej (grafik godzin, tabela instruktorów, wzorce klasyfikacji)
// to odtworzenie logiki v1 — przed użyciem produkcyjnym porównaj je 1:1 z v1
// i popraw wartości. Reszta pipeline'u jest od nich niezależna.

export const KONFIG = {
  // Grafik tygodniowy: 0 = niedziela ... 6 = sobota. null = zamknięte.
  godzinyOtwarcia: {
    0: { od: '10:00', do: '18:30' },   // niedziela
    1: { od: '11:00', do: '18:30' },   // poniedziałek
    2: { od: '12:00', do: '18:30' },   // wtorek
    3: { od: '12:00', do: '18:30' },   // środa
    4: { od: '12:00', do: '18:30' },   // czwartek
    5: { od: '12:00', do: '19:30' },   // piątek
    6: { od: '10:00', do: '19:30' },   // sobota
  },

  // Tabela instruktorów: ilu instruktorów obsługuje grupę N osób (spec 1.0, sekcja 5.3).
  // Dopasowanie: pierwszy wpis, dla którego osoby <= doOsob.
  tabelaInstruktorow: [
    { doOsob: 2, instruktorzy: 1 },
    { doOsob: 7, instruktorzy: 2 },
    { doOsob: 12, instruktorzy: 3 },
    { doOsob: 14, instruktorzy: 4 },
    { doOsob: 15, instruktorzy: 5 },
  ],
  instruktorzyPowyzejTabeli: 6,   // 16 osób i więcej — wartość stała, nie przeliczana

  // UWAGA: obsada NIE jest stałą pulą. Liczbę instruktorów w danym przedziale niesie kalendarz
  // (wydarzenie o czysto numerycznym tytule, np. „4"). Brak takiego wydarzenia = zero obsady.

  // Krok siatki slotów w minutach.
  krokSlotuMin: 30,

  // Domyślny czas trwania wizyty.
  domyslnyCzasTrwaniaMin: 30,

  // Wzorce klasyfikacji eventów (na tytule + opisie).
  wzorce: {
    // "4os", "4 os.", "4 osoby", "TAXI 2os"
    rezerwacja: /(\d{1,2})\s*os(?:\.|oby|ób|ob)?\b/i,
    anulowana: /(anulowan|odwo[lł]an|rezygnacj|cancell?ed?)/i,
    // Czysto numeryczny tytuł („4") — deklaracja obsady instruktorów w tym przedziale.
    obsada: /^\s*(\d{1,2})\s*$/,
    // Eventy oznaczające zajętego/nieobecnego instruktora (rozszerzenie poza spec 1.0).
    instruktor: /(instruktor|urlop|l4|zwolnienie|szkolenie wewn)/i,
    // Eventy całkowicie ignorowane przy liczeniu dostępności.
    ignorowane: /(urodziny|imieniny|przypomnienie|notatka)/i,
    znacznik: /^\s*(start|koniec|jdg)\b/i,
    // Otwarta kwestia z v1/v2: "TAXI Xos" pasuje do wzorca rezerwacji.
    taxi: /\btaxi\b/i,
  },
};

/* ────────────────────────── iCal: parser ────────────────────────── */

/** Rozwija złamane linie iCal (RFC 5545: kontynuacja zaczyna się od spacji/tab). */
export function rozwinLinie(tekst) {
  return String(tekst)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');
}

function odkodujTekst(v) {
  return String(v)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Parsuje wartość DTSTART/DTEND.
 * - sufiks Z → czas UTC (dokładnie)
 * - TZID lub brak strefy → czas lokalny przeglądarki (ograniczenie #3 ze spec)
 * - sama data (VALUE=DATE) → wydarzenie całodniowe
 */
export function parsujDateICal(wartosc) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(wartosc).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { date: new Date(+y, +mo - 1, +d, 0, 0, 0), calodniowe: true };
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), calodniowe: false };
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +s), calodniowe: false };
}

/**
 * Inkrementalny parser iCal — karmiony fragmentami, trzyma w pamięci tylko bieżącą linię
 * i wydarzenia, które przeszły `filtr`.
 *
 * Powód: eksport kalendarza strzelnicy to ~40 MB. Wariant „wczytaj całość i podziel"
 * tworzył kilka kopii pliku plus tablicę ponad miliona stringów — kilkaset MB szczytowo
 * w service workerze, czyli realne ryzyko OOM. Tutaj zużycie zależy od liczby wydarzeń
 * w oknie, nie od rozmiaru pliku.
 *
 * `filtr` dostaje znormalizowane wydarzenie i decyduje, czy je zachować (null = zachowaj wszystko).
 * RRULE nie jest rozwijane (ograniczenie #2 ze spec) — event dostaje flagę `cykliczne`.
 */
export function stworzParserICal({ filtr = null } = {}) {
  let resztka = '';
  let biezaca = null;      // składana linia logiczna (RFC 5545)
  let biezacy = null;      // event w budowie
  let otwarty = false;     // widziano BEGIN:VCALENDAR
  let zamkniety = false;   // widziano END:VCALENDAR
  let wszystkich = 0;
  const eventy = [];

  function liniaLogiczna(linia) {
    const trimmed = linia.trim();

    if (trimmed === 'BEGIN:VEVENT') { biezacy = { cykliczne: false }; return; }
    if (trimmed === 'END:VEVENT') {
      if (biezacy && biezacy.start) {
        const ev = znormalizujEvent(biezacy);
        wszystkich++;
        if (!filtr || filtr(ev)) eventy.push(ev);
      }
      biezacy = null;
      return;
    }
    if (!biezacy) {
      // Znaczniki koperty kalendarza — poza VEVENT, więc sprawdzamy je tutaj.
      if (/^BEGIN:VCALENDAR$/i.test(trimmed)) otwarty = true;
      else if (/^END:VCALENDAR$/i.test(trimmed)) zamkniety = true;
      return;
    }

    const idx = linia.indexOf(':');
    if (idx === -1) return;
    const lewa = linia.slice(0, idx);
    const wartosc = linia.slice(idx + 1);
    const [nazwa, ...paramy] = lewa.split(';');
    const params = Object.fromEntries(
      paramy.map((p) => {
        const i = p.indexOf('=');
        return i === -1 ? [p.toUpperCase(), ''] : [p.slice(0, i).toUpperCase(), p.slice(i + 1)];
      })
    );

    switch (nazwa.toUpperCase()) {
      case 'UID': biezacy.uid = wartosc.trim(); break;
      case 'SUMMARY': biezacy.tytul = odkodujTekst(wartosc); break;
      case 'DESCRIPTION': biezacy.opis = odkodujTekst(wartosc); break;
      case 'LOCATION': biezacy.miejsce = odkodujTekst(wartosc); break;
      case 'STATUS': biezacy.status = wartosc.trim().toUpperCase(); break;
      case 'RRULE': biezacy.cykliczne = true; biezacy.rrule = wartosc.trim(); break;
      case 'DTSTART': {
        const p = parsujDateICal(wartosc);
        if (p) { biezacy.start = p.date; biezacy.calodniowe = p.calodniowe; biezacy.tzid = params.TZID || null; }
        break;
      }
      case 'DTEND': {
        const p = parsujDateICal(wartosc);
        if (p) biezacy.end = p.date;
        break;
      }
      case 'DURATION': biezacy.duration = wartosc.trim(); break;
      default: break;
    }
  }

  /** Linia fizyczna; zaczynająca się od spacji/tab jest kontynuacją poprzedniej. */
  function liniaFizyczna(linia) {
    if (biezaca !== null && (linia.startsWith(' ') || linia.startsWith('\t'))) {
      biezaca += linia.slice(1);   // RFC 5545: znika dokładnie jeden znak składania
      return;
    }
    if (biezaca !== null) liniaLogiczna(biezaca);
    biezaca = linia;
  }

  return {
    dodajFragment(fragment) {
      let tekst = resztka + String(fragment);
      resztka = '';
      // Końcowy \r przytrzymujemy — dopiero następny fragment powie, czy to \r\n, czy samotny \r.
      let trzymajCR = false;
      if (tekst.endsWith('\r')) { tekst = tekst.slice(0, -1); trzymajCR = true; }
      tekst = tekst.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const czesci = tekst.split('\n');
      resztka = czesci.pop() + (trzymajCR ? '\r' : '');
      for (const l of czesci) liniaFizyczna(l);
    },

    zakoncz() {
      if (resztka) { liniaFizyczna(resztka.replace(/\r/g, '')); resztka = ''; }
      if (biezaca !== null) { liniaLogiczna(biezaca); biezaca = null; }
      return { eventy, wszystkich, otwarty, zamkniety };
    },
  };
}

/**
 * Parsuje tekst iCal → lista surowych eventów.
 * Cienka nakładka na `stworzParserICal`, żeby istniała jedna implementacja parsera.
 */
export function parsujICal(tekst) {
  const parser = stworzParserICal();
  parser.dodajFragment(tekst);
  return parser.zakoncz().eventy;
}

function znormalizujEvent(e) {
  let end = e.end;
  if (!end && e.duration) end = new Date(e.start.getTime() + czasTrwaniaZISO(e.duration));
  if (!end) end = new Date(e.start.getTime() + (e.calodniowe ? 24 * 3600e3 : 3600e3));
  return {
    uid: e.uid || '',
    tytul: e.tytul || '',
    opis: e.opis || '',
    miejsce: e.miejsce || '',
    start: e.start,
    end,
    calodniowe: !!e.calodniowe,
    status: e.status || 'CONFIRMED',
    cykliczne: !!e.cykliczne,
    tzid: e.tzid || null,
  };
}

function czasTrwaniaZISO(d) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(d).trim());
  if (!m) return 3600e3;
  const dni = +(m[1] || 0), g = +(m[2] || 0), min = +(m[3] || 0), s = +(m[4] || 0);
  return ((dni * 24 + g) * 3600 + min * 60 + s) * 1000;
}

/* ────────────────────── Cache eventów (postać do chrome.storage) ────────────────────── */

/** Maksymalna długość opisu trzymanego w cache — klasyfikacja patrzy na tytuł i początek opisu. */
export const MAX_OPIS_W_CACHE = 500;

/**
 * Eventy → lekka, JSON-owalna postać do cache: tylko okno czasowe, które realnie
 * jest sprawdzane, daty jako ISO, opis przycięty. Pełny tekst iCal nigdy nie trafia
 * do storage — kalendarz z wieloletnią historią potrafi mieć wiele MB i przekracza
 * limit `chrome.storage.local` (QUOTA_BYTES = 10 MB).
 */
export function kompaktujEventy(eventy, { od = null, do: doKiedy = null } = {}) {
  const odMs = od ? (od instanceof Date ? od.getTime() : new Date(od).getTime()) : -Infinity;
  const doMs = doKiedy ? (doKiedy instanceof Date ? doKiedy.getTime() : new Date(doKiedy).getTime()) : Infinity;

  return eventy
    .filter((e) => e.end.getTime() > odMs && e.start.getTime() < doMs)
    .map((e) => ({
      uid: e.uid,
      tytul: e.tytul,
      opis: e.opis.length > MAX_OPIS_W_CACHE ? e.opis.slice(0, MAX_OPIS_W_CACHE) : e.opis,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
      calodniowe: e.calodniowe,
      status: e.status,
      cykliczne: e.cykliczne,
      tzid: e.tzid,
    }));
}

/** Odwrotność `kompaktujEventy` — przywraca obiekty Date oczekiwane przez resztę pipeline'u. */
export function odtworzEventy(kompaktne) {
  return (kompaktne || []).map((e) => ({
    uid: e.uid || '',
    tytul: e.tytul || '',
    opis: e.opis || '',
    miejsce: '',
    start: new Date(e.start),
    end: new Date(e.end),
    calodniowe: !!e.calodniowe,
    status: e.status || 'CONFIRMED',
    cykliczne: !!e.cykliczne,
    tzid: e.tzid || null,
  }));
}

/* ────────────────────── Data / czas: pomocnicze ────────────────────── */

export function naISO(data) {
  const d = data instanceof Date ? data : new Date(data);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function hhmm(data) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(data.getHours())}:${p(data.getMinutes())}`;
}

function minutyOd(hhmmStr) {
  const [g, m] = String(hhmmStr).split(':').map(Number);
  return g * 60 + (m || 0);
}

function dataZMinut(dataISO, minuty) {
  const [y, m, d] = dataISO.split('-').map(Number);
  return new Date(y, m - 1, d, 0, minuty, 0);
}

/** Eventy, które w jakimkolwiek momencie nachodzą na wybrany dzień. */
export function eventyDnia(eventy, dataISO) {
  const poczatek = dataZMinut(dataISO, 0);
  const koniec = dataZMinut(dataISO, 24 * 60);
  return eventy.filter((e) => e.start < koniec && e.end > poczatek);
}

/* ────────────────────── Klasyfikacja eventów ────────────────────── */

/** Typy: 'anulowana' | 'obsada' | 'rezerwacja' | 'instruktor' | 'ignorowane'. */
/**
 * Podmienia wydarzenia jednego dnia na odczytane z innego źródła (DOM Kalendarza).
 *
 * Bazą zostaje iCal — zna wszystkie daty — ale dla `dataISO` liczą się wyłącznie wydarzenia
 * świeże. Dlatego z bazy wypadają WSZYSTKIE nachodzące na ten dzień, także te, których widok
 * dnia nie pokazał: gdyby zostały, anulowana rezerwacja z cache'u nadal blokowałaby slot.
 */
export function polaczNaDzien(bazowe, zDnia, dataISO) {
  const poczatek = new Date(`${dataISO}T00:00:00`);
  const koniec = new Date(poczatek.getTime() + 24 * 3600e3);
  const odMs = poczatek.getTime();
  const doMs = koniec.getTime();

  const pozostale = (bazowe || []).filter(
    (e) => !(e.end.getTime() > odMs && e.start.getTime() < doMs)
  );
  return [...pozostale, ...(zDnia || [])];
}

export function klasyfikujEventy(eventy) {
  return eventy.map((e) => {
    const tekst = `${e.tytul} ${e.opis}`.trim();
    const wynik = { ...e, typ: 'ignorowane', osoby: null, liczba: null, uwagi: [] };

    if (e.status === 'CANCELLED' || KONFIG.wzorce.anulowana.test(tekst)) {
      wynik.typ = 'anulowana';
      return wynik;
    }
    if (e.calodniowe) {
      wynik.uwagi.push('wydarzenie całodniowe pominięte przy liczeniu slotów');
      return wynik;
    }

    // Deklaracja obsady — sprawdzana na SAMYM tytule, nie na tytule z opisem,
    // bo „czysto numeryczny" to warunek na tytule (spec 1.0, 5.3).
    const mObsada = KONFIG.wzorce.obsada.exec(e.tytul || '');
    if (mObsada) {
      wynik.typ = 'obsada';
      wynik.liczba = Number(mObsada[1]);
      return wynik;
    }

    if (KONFIG.wzorce.ignorowane.test(tekst)) return wynik;

    const m = KONFIG.wzorce.rezerwacja.exec(tekst);
    if (m) {
      wynik.typ = 'rezerwacja';
      wynik.osoby = Number(m[1]);
      if (KONFIG.wzorce.taxi.test(tekst)) {
        // Otwarta kwestia z v1 (sekcja 5.2 spec) — zachowanie bez zmian, ale oznaczone.
        wynik.uwagi.push('event typu TAXI policzony jako rezerwacja klienta (kwestia nierozstrzygnięta)');
      }
      return wynik;
    }
    if (KONFIG.wzorce.instruktor.test(tekst)) {
      wynik.typ = 'instruktor';
      return wynik;
    }
    if (KONFIG.wzorce.znacznik.test(e.tytul || '')) {
      wynik.typ = 'znacznik';
      return wynik;
    }
    return wynik;
  });
}

/* ────────────────────── Instruktorzy i godziny ────────────────────── */

export function liczbaInstruktorowDlaOsob(osoby) {
  const n = Number(osoby);
  if (!Number.isFinite(n) || n <= 0) return 0;
  for (const wiersz of KONFIG.tabelaInstruktorow) {
    if (n <= wiersz.doOsob) return wiersz.instruktorzy;
  }
  return KONFIG.instruktorzyPowyzejTabeli;
}

export function godzinyOtwarciaDlaDnia(dataISO) {
  const [y, m, d] = dataISO.split('-').map(Number);
  const dzien = new Date(y, m - 1, d).getDay();
  const g = KONFIG.godzinyOtwarcia[dzien];
  if (!g) return null;
  return { od: minutyOd(g.od), do: minutyOd(g.do), odTekst: g.od, doTekst: g.do };
}

/* ────────────────────── Wyznaczanie slotów ────────────────────── */

/**
 * Najmniejsza liczba wolnych instruktorów w przedziale [a, b).
 *
 * Przedział tniemy na pod-odcinki punktami granicznymi wszystkich nachodzących wydarzeń, bo
 * rezerwacja potrafi rozjechać się na kilka bloków obsady. Slot jest dobry tylko wtedy, gdy
 * wystarcza w KAŻDYM pod-odcinku — stąd minimum, nie średnia.
 *
 * Obsadę niesie kalendarz (wydarzenia typu `obsada`). Brak takiego wydarzenia w danym momencie
 * to zero dostępnych instruktorów — luka w grafiku znaczy „nikogo nie ma", nie „ktoś pewnie jest".
 */
export function wolniInstruktorzyWPrzedziale({ a, b, obsada, obciazajace }) {
  const odMs = a.getTime();
  const doMs = b.getTime();

  const punkty = new Set([odMs, doMs]);
  for (const e of [...obsada, ...obciazajace]) {
    for (const t of [e.start.getTime(), e.end.getTime()]) {
      if (t > odMs && t < doMs) punkty.add(t);
    }
  }
  const granice = [...punkty].sort((x, y) => x - y);

  let minimum = Infinity;
  for (let i = 0; i < granice.length - 1; i++) {
    const srodek = (granice[i] + granice[i + 1]) / 2;   // próbka ze środka — bez sporów o granice

    let dostepni = 0;
    for (const e of obsada) {
      if (e.start.getTime() <= srodek && e.end.getTime() > srodek) dostepni += e.liczba;
    }
    let zajeci = 0;
    for (const e of obciazajace) {
      if (e.start.getTime() <= srodek && e.end.getTime() > srodek) {
        zajeci += e.typ === 'rezerwacja' ? liczbaInstruktorowDlaOsob(e.osoby) : 1;
      }
    }
    minimum = Math.min(minimum, dostepni - zajeci);
  }

  return Math.max(0, minimum === Infinity ? 0 : minimum);
}

export function wyznaczDostepneSloty({ eventy, dataISO, osoby, czasTrwaniaMin }) {
  const czas = Number(czasTrwaniaMin) || KONFIG.domyslnyCzasTrwaniaMin;
  const wymagani = liczbaInstruktorowDlaOsob(osoby);
  const godziny = godzinyOtwarciaDlaDnia(dataISO);
  const uwagi = [];

  if (!godziny) {
    return { dataISO, otwarte: false, godziny: null, osoby: Number(osoby), czasTrwaniaMin: czas,
      wymaganiInstruktorzy: wymagani, sloty: [], proponowane: [], eventy: [],
      uwagi: ['Tego dnia strzelnica jest zamknięta.'] };
  }

  const zDnia = klasyfikujEventy(eventyDnia(eventy, dataISO));
  if (zDnia.some((e) => e.cykliczne)) {
    uwagi.push('w kalendarzu tego dnia są wydarzenia cykliczne — parser ich nie rozwija (ograniczenie #2)');
  }
  for (const e of zDnia) for (const u of e.uwagi) if (!uwagi.includes(u)) uwagi.push(u);

  const obsada = zDnia.filter((e) => e.typ === 'obsada');
  const obciazajace = zDnia.filter((e) => e.typ === 'rezerwacja' || e.typ === 'instruktor');

  if (!obsada.length) {
    uwagi.push('brak w kalendarzu wydarzeń z obsadą instruktorów (tytuł numeryczny) — cały dzień liczony jako bez obsady');
  }

  const sloty = [];
  for (let start = godziny.od; start + czas <= godziny.do; start += KONFIG.krokSlotuMin) {
    const a = dataZMinut(dataISO, start);
    const b = dataZMinut(dataISO, start + czas);
    const wolni = wolniInstruktorzyWPrzedziale({ a, b, obsada, obciazajace });

    sloty.push({
      od: hhmm(a),
      do: hhmm(b),
      wolniInstruktorzy: wolni,
      dostepny: wymagani > 0 && wolni >= wymagani,
    });
  }

  return { dataISO, otwarte: true, godziny, osoby: Number(osoby), czasTrwaniaMin: czas,
    wymaganiInstruktorzy: wymagani, sloty, proponowane: proponowaneGodziny(sloty),
    eventy: zDnia, uwagi };
}

/** Sprawdza konkretną, preferowaną godzinę na tle wyliczonych slotów. */
export function sprawdzDostepnoscSlotu(wynik, preferowanaGodzina) {
  if (!preferowanaGodzina) return null;
  const cel = minutyOd(preferowanaGodzina);
  const dopasowany = wynik.sloty.find((s) => minutyOd(s.od) === cel);
  if (dopasowany) {
    return { godzina: dopasowany.od, dostepny: dopasowany.dostepny, slot: dopasowany, dokladne: true };
  }
  let najblizszy = null;
  for (const s of wynik.sloty) {
    const d = Math.abs(minutyOd(s.od) - cel);
    if (!najblizszy || d < najblizszy.d) najblizszy = { d, s };
  }
  return { godzina: preferowanaGodzina, dostepny: false, slot: najblizszy ? najblizszy.s : null, dokladne: false };
}

const DNI_PL = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

/** Scala kolejne dostępne sloty w czytelne zakresy. */
function zakresy(sloty) {
  const out = [];
  for (const s of sloty.filter((x) => x.dostepny)) {
    const ostatni = out[out.length - 1];
    if (ostatni && minutyOd(ostatni.do) >= minutyOd(s.od)) {
      if (minutyOd(s.do) > minutyOd(ostatni.do)) ostatni.do = s.do;
    } else {
      out.push({ od: s.od, do: s.do });
    }
  }
  return out;
}

/**
 * Godziny do zaproponowania klientowi — pełne godziny mają pierwszeństwo, połówki są awaryjne.
 *
 * Siatka slotów jest co 30 min, ale klientowi nie podajemy każdego wolnego startu z rzędu
 * (12:00, 12:30, 13:00 …) — to dla niego nieczytelne i rozjeżdża grafik. Idziemy po dniu kursorem:
 *   1. sprawdzamy pełną godzinę — wolna? bierzemy ją,
 *   2. zajęta? sprawdzamy tę samą godzinę + 30 min,
 *   3. obie zajęte? kursor skacze na następną pełną godzinę.
 * Po wziętym terminie kursor idzie na pierwszą pełną godzinę po jego końcu, więc propozycje
 * nigdy na siebie nie nachodzą.
 *
 * Przykład (2 os., 30 min): 12:00 wolne → bierzemy; 13:00 zajęte, 13:30 wolne → bierzemy;
 * dalej od 14:00. Wynik: „12:00, 13:30, …".
 *
 * Gdy strzelnica otwiera się o połowie godziny, zaczynamy od pierwszej pełnej godziny —
 * przed nią nie ma czego porównywać.
 */
export function proponowaneGodziny(sloty) {
  const wg = new Map((sloty || []).map((s) => [minutyOd(s.od), s]));
  const klucze = [...wg.keys()].sort((x, y) => x - y);
  if (!klucze.length) return [];

  const ostatni = klucze[klucze.length - 1];
  const pelnaOd = (t) => (t % 60 === 0 ? t : t + (60 - (t % 60)));

  const out = [];
  let kursor = pelnaOd(klucze[0]);
  while (kursor <= ostatni) {
    const wybrany = [kursor, kursor + KONFIG.krokSlotuMin]
      .map((t) => wg.get(t))
      .find((s) => s && s.dostepny);

    if (!wybrany) { kursor += 60; continue; }
    out.push(wybrany.od);
    kursor = pelnaOd(minutyOd(wybrany.do));
  }
  return out;
}

/** Tekst dla człowieka i dla promptu agenta (sekcja 5.4 spec). */
export function sformatujDostepnosc(wynik, preferowana = null) {
  const [y, m, d] = wynik.dataISO.split('-').map(Number);
  const dzien = DNI_PL[new Date(y, m - 1, d).getDay()];
  const dataTekst = `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y} (${dzien})`;

  if (!wynik.otwarte) return `${dataTekst}: strzelnica nieczynna.`;

  const linie = [
    `${dataTekst}, ${wynik.osoby} os., ${wynik.czasTrwaniaMin} min ` +
    `(potrzeba instruktorów: ${wynik.wymaganiInstruktorzy}; godziny otwarcia ${wynik.godziny.odTekst}–${wynik.godziny.doTekst}).`,
  ];

  const wolne = zakresy(wynik.sloty);
  const proponowane = wynik.proponowane || proponowaneGodziny(wynik.sloty);
  if (!wolne.length) {
    linie.push('Brak wolnych terminów tego dnia.');
  } else {
    linie.push(`Wolne przedziały: ${wolne.map((z) => `${z.od}–${z.do}`).join(', ')}.`);
    linie.push(`Godziny do zaproponowania: ${proponowane.join(', ')}.`);
  }

  if (preferowana) {
    const p = sprawdzDostepnoscSlotu(wynik, preferowana);
    if (p) {
      linie.push(
        p.dostepny
          ? `Preferowana godzina ${p.godzina}: WOLNE.`
          : `Preferowana godzina ${p.godzina}: ZAJĘTE${p.dokladne ? '' : ' (godzina poza siatką slotów)'}.`
      );
    }
  }
  for (const u of wynik.uwagi) linie.push(`Uwaga: ${u}`);
  return linie.join('\n');
}

/* ────────────────────── Auto-wykrywanie daty w tekście ────────────────────── */

const MIESIACE_PL = {
  stycz: 1, luty: 2, lute: 2, marc: 3, marz: 3, kwiet: 4, maj: 5, czerw: 6, lip: 7,
  sierp: 8, wrzes: 9, wrześ: 9, paźdz: 10, pazdz: 10, listop: 11, grud: 12,
};

/**
 * Wyszukuje daty w swobodnym tekście maila.
 * @returns {{dataISO:string|null, pewnosc:'wysoka'|'niska'|'brak', kandydaci:string[], godzina:string|null}}
 */
export function wykryjDateWTekscie(tekst, dzisiaj = new Date()) {
  const t = String(tekst || '');
  const kandydaci = [];
  const rok = dzisiaj.getFullYear();
  const dodaj = (y, m, d) => {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!kandydaci.includes(iso)) kandydaci.push(iso);
  };

  for (const m of t.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) dodaj(+m[1], +m[2], +m[3]);
  for (const m of t.matchAll(/\b(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}|\d{2}))?\b/g)) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : rok;
    dodaj(y, +m[2], +m[1]);
  }
  for (const m of t.matchAll(/\b(\d{1,2})\s+([a-ząćęłńóśźż]{3,})\s*(20\d{2})?/gi)) {
    const klucz = Object.keys(MIESIACE_PL).find((k) => m[2].toLowerCase().startsWith(k));
    if (klucz) dodaj(m[3] ? +m[3] : rok, MIESIACE_PL[klucz], +m[1]);
  }
  const przesun = (dni) => {
    const d = new Date(dzisiaj.getFullYear(), dzisiaj.getMonth(), dzisiaj.getDate() + dni);
    dodaj(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };
  if (/\bdzi[sś]\b|\bdzisiaj\b/i.test(t)) przesun(0);
  if (/\bjutro\b/i.test(t)) przesun(1);
  if (/\bpojutrze\b/i.test(t)) przesun(2);

  let godzina = null;
  const g = /\b(\d{1,2}):(\d{2})\b/.exec(t) || /\b(?:o|na|około|ok\.)\s*(\d{1,2})(?:[.](\d{2}))?\b/i.exec(t);
  if (g) {
    const gg = +g[1];
    const mm = g[2] ? +g[2] : 0;
    if (gg >= 6 && gg <= 23 && mm < 60) godzina = `${String(gg).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  if (!kandydaci.length) return { dataISO: null, pewnosc: 'brak', kandydaci: [], godzina };
  return { dataISO: kandydaci[0], pewnosc: kandydaci.length === 1 ? 'wysoka' : 'niska', kandydaci, godzina };
}

/* ────────────────────── Pełny pipeline dostępności ────────────────────── */

/** klasyfikuj → sloty → format, na eventach już sparsowanych (z fetcha albo z cache). */
export function policzDostepnoscZEventow({ eventy, dataISO, osoby, czasTrwaniaMin, preferowanaGodzina }) {
  const wynik = wyznaczDostepneSloty({ eventy, dataISO, osoby, czasTrwaniaMin });
  return {
    ...wynik,
    preferowanaGodzina: preferowanaGodzina || null,
    tekst: sformatujDostepnosc(wynik, preferowanaGodzina),
  };
}

/** pobierzEventyDnia (fetch iCal robi background.js) → klasyfikuj → sloty → format. */
export function policzDostepnosc({ tekstICal, dataISO, osoby, czasTrwaniaMin, preferowanaGodzina }) {
  return policzDostepnoscZEventow({
    eventy: parsujICal(tekstICal),
    dataISO, osoby, czasTrwaniaMin, preferowanaGodzina,
  });
}

/* ────────────────────── Heurystyka języka (opcja tłumaczenia) ────────────────────── */

const POLSKIE_SLOWA = /\b(nie|tak|jest|są|czy|proszę|dzień|dobry|witam|pozdrawiam|dziękuję|chciałbym|chciałabym|mamy|można|termin|osób|osoby|godzina|strzelnica|pakiet|cena|wolne|maila|państwo)\b/gi;

/**
 * Zgrubna detekcja polszczyzny — wystarczająca, by nie wysyłać polskich maili do tłumaczenia.
 * Świadomie konserwatywna: przy wątpliwości zwraca false (czyli tekst pójdzie do modelu).
 */
export function wygladaNaPolski(tekst) {
  const t = String(tekst || '');
  if (t.trim().length < 20) return false;
  const diakrytyki = (t.match(/[ąćęłńóśźż]/gi) || []).length;
  const slowa = (t.match(POLSKIE_SLOWA) || []).length;
  const wszystkieSlowa = (t.match(/\S+/g) || []).length || 1;
  return diakrytyki / wszystkieSlowa > 0.05 || slowa >= 3;
}

/* ────────────────────── Wzorce maili (5.5) ────────────────────── */

const OGONKI = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

/** Do wyszukiwania: małe litery bez polskich znaków, żeby „zaliczka" znalazło „Zaliczkę". */
function bezOgonkow(tekst) {
  return String(tekst || '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => OGONKI[c]);
}

/** Wstawki w treści wzorca: {{imie}}, {{data wizyty}}. */
const WSTAWKA = /\{\{\s*([^{}\n]{1,40}?)\s*\}\}/g;

/** Nazwy wstawek w kolejności wystąpienia, bez powtórzeń. */
export function polaWzorca(tresc) {
  const pola = [];
  for (const m of String(tresc || '').matchAll(WSTAWKA)) {
    const nazwa = m[1].trim();
    if (nazwa && !pola.includes(nazwa)) pola.push(nazwa);
  }
  return pola;
}

/**
 * Treść wzorca jest przechowywana jako HTML (pogrubienia, podkreślenia, listy).
 * Te dwie funkcje to most do świata plain-text: podgląd na liście, wariant `text/plain`
 * w schowku i migracja wzorców zapisanych przed wprowadzeniem formatowania.
 */
export function naHtmlZTekstu(tekst) {
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return String(tekst || '')
    .split(/\n{2,}/)
    .map((akapit) => `<div>${esc(akapit).split('\n').join('<br>') || '<br>'}</div>`)
    .join('<div><br></div>');
}

const LINK = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;

export function naTekstZHtml(html) {
  return String(html || '')
    // „Link do mapy" bez adresu byłby w plain-text bezużyteczny, więc adres idzie w nawiasie.
    .replace(LINK, (_, wDwoch, wJednym, tresc) => {
      const url = wDwoch ?? wJednym ?? '';
      const etykieta = tresc.replace(/<[^>]+>/g, '').trim();
      if (!url) return etykieta;
      return !etykieta || etykieta === url ? url : `${etykieta} (${url})`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6])\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')   // na końcu, żeby "&amp;lt;" nie rozwinęło się do "<"
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Tagi z pola tekstowego: „rezerwacja, PL" → ['rezerwacja', 'PL'] (bez duplikatów). */
export function parsujTagi(tekst) {
  const tagi = [];
  for (const t of String(tekst || '').split(/[,;]/)) {
    const tag = t.trim();
    if (tag && !tagi.some((x) => bezOgonkow(x) === bezOgonkow(tag))) tagi.push(tag);
  }
  return tagi;
}

/** Sanityzacja tego, co przyszło ze storage — plik mógł być edytowany ręcznie lub pochodzić ze starszej wersji. */
export function normalizujWzorce(surowe) {
  if (!Array.isArray(surowe)) return [];
  return surowe
    .filter((w) => w && typeof w === 'object')
    .map((w, i) => ({
      id: String(w.id || `w-${i}`),
      nazwa: String(w.nazwa || '').trim() || 'Bez nazwy',
      tagi: Array.isArray(w.tagi) ? parsujTagi(w.tagi.join(',')) : parsujTagi(w.tagi),
      // Wzorce sprzed wersji z formatowaniem nie mają `format` — ich plain text trzeba przepisać na HTML.
      tresc: w.format === 'html' ? String(w.tresc || '') : naHtmlZTekstu(w.tresc),
      format: 'html',
      zmieniono: Number(w.zmieniono) || 0,
    }));
}

/** Alfabetycznie po nazwie — lista ma być przewidywalna przy szukaniu wzrokiem. */
export function posortujWzorce(wzorce) {
  return [...wzorce].sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'));
}

/** Filtr listy: wszystkie słowa frazy muszą wystąpić w nazwie, tagach albo treści. */
export function filtrujWzorce(wzorce, fraza) {
  const slowa = bezOgonkow(fraza).split(/\s+/).filter(Boolean);
  if (!slowa.length) return [...wzorce];
  return wzorce.filter((w) => {
    const szukalne = bezOgonkow(`${w.nazwa} ${(w.tagi || []).join(' ')} ${naTekstZHtml(w.tresc)}`);
    return slowa.every((s) => szukalne.includes(s));
  });
}

/* ────────────────────── Wzorzec odpowiedzi o dostępności ────────────────────── */

const BRAK_TERMINOW = 'brak wolnych terminów';

/** Nazwy wstawek, które pipeline dostępności potrafi wypełnić sam. */
export const POLA_DOSTEPNOSCI = ['terminy', 'godziny', 'data', 'dzien', 'osoby', 'czas', 'otwarcie'];

/**
 * Wartości do wzorca odpowiedzi dla klienta.
 * `wynik.tekst` to notatka dla operatora — obsada instruktorów, godziny otwarcia, uwagi parsera —
 * i do maila nie nadaje się w całości. Do klienta idą wyłącznie pola poniżej.
 */
export function wartosciDostepnosci(wynik) {
  const [y, m, d] = wynik.dataISO.split('-').map(Number);
  const sloty = wynik.sloty || [];
  const proponowane = wynik.proponowane || proponowaneGodziny(sloty);
  const lista = proponowane.length ? proponowane.join(', ') : BRAK_TERMINOW;

  // Do klienta idą konkretne godziny, nie przedziały — `{{terminy}}` i `{{godziny}}` dają to samo,
  // żeby żaden wzorzec nie skończył z pustym miejscem na wynik.
  return {
    terminy: lista,
    godziny: lista,
    data: `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`,
    dzien: DNI_PL[new Date(y, m - 1, d).getDay()],
    osoby: String(wynik.osoby),
    czas: `${wynik.czasTrwaniaMin} min`,
    otwarcie: wynik.otwarte ? `${wynik.godziny.odTekst}–${wynik.godziny.doTekst}` : 'nieczynne',
  };
}

/**
 * Podstawia wartości we wzorcu (HTML). Wstawki spoza `POLA_DOSTEPNOSCI` — np. `{{imie}}` —
 * zostają nietknięte: pipeline ich nie zna, uzupełnia je człowiek przed wysłaniem.
 */
export function zastosujWzorzecDostepnosci(html, wartosci) {
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return String(html || '').replace(WSTAWKA, (calosc, nazwa) => {
    const klucz = nazwa.trim().toLowerCase();
    return klucz in wartosci ? esc(wartosci[klucz]) : calosc;
  });
}

/**
 * Czy wzorzec ma gdzie przyjąć wynik sprawdzenia? Bez żadnej ze wstawek z `POLA_DOSTEPNOSCI`
 * podstawienie się wykona, ale godziny nie trafią do treści — a to wygląda jak brak reakcji.
 */
export function wzorzecZnaDostepnosc(html) {
  return polaWzorca(naTekstZHtml(html)).some((p) => POLA_DOSTEPNOSCI.includes(p.trim().toLowerCase()));
}

/**
 * Wzorzec odpowiedzi wskazywany nazwą wpisaną z ręki. Porównanie ignoruje wielkość liter,
 * ogonki i białe znaki na brzegach; gdy nie ma trafienia dokładnego, próbuje jednoznacznego
 * dopasowania po początku nazwy — żeby nie trzeba było dopisywać jej do końca.
 */
export function znajdzWzorzecPoNazwie(wzorce, nazwa) {
  const szukana = bezOgonkow(String(nazwa || '').trim());
  if (!szukana) return { wzorzec: null, status: 'pusto', kandydaci: [] };

  const dokladne = wzorce.filter((w) => bezOgonkow(w.nazwa.trim()) === szukana);
  if (dokladne.length === 1) return { wzorzec: dokladne[0], status: 'znaleziony', kandydaci: [] };
  if (dokladne.length > 1) {
    return { wzorzec: dokladne[0], status: 'duplikat', kandydaci: dokladne.map((w) => w.nazwa) };
  }

  const odPoczatku = wzorce.filter((w) => bezOgonkow(w.nazwa.trim()).startsWith(szukana));
  if (odPoczatku.length === 1) return { wzorzec: odPoczatku[0], status: 'prefiks', kandydaci: [] };
  if (odPoczatku.length > 1) {
    return { wzorzec: null, status: 'niejednoznaczny', kandydaci: odPoczatku.map((w) => w.nazwa) };
  }
  return { wzorzec: null, status: 'brak', kandydaci: [] };
}

/**
 * Adres wpisany z ręki → adres nadający się do `href`. Przepuszczamy wyłącznie http(s) i mailto —
 * te same schematy, które przechodzą przez allowlistę sanitizera. Pusty wynik = adres do odrzucenia.
 */
export function normalizujUrl(wejscie) {
  const t = String(wejscie || '').trim();
  if (!t) return '';
  // Jawny schemat: akceptujemy tylko pełne http(s):// i mailto:.
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return /^(https?:\/\/|mailto:)/i.test(t) ? t : '';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return `mailto:${t}`;
  // „maps.google.com/…", „www.strzelnica.pl" — brak schematu uzupełniamy o https://.
  if (/^[\w-]+(\.[\w-]+)+([/:?#]|$)/.test(t)) return `https://${t}`;
  return '';
}
