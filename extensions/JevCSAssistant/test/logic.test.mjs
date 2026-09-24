// Testy czystej logiki — uruchom: node --test test/logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KONFIG, parsujICal, parsujDateICal, rozwinLinie, klasyfikujEventy, eventyDnia, polaczNaDzien, hhmm,
  liczbaInstruktorowDlaOsob, godzinyOtwarciaDlaDnia, wyznaczDostepneSloty,
  sprawdzDostepnoscSlotu, sformatujDostepnosc, wykryjDateWTekscie, policzDostepnosc,
  kompaktujEventy, odtworzEventy, policzDostepnoscZEventow, MAX_OPIS_W_CACHE,
  polaWzorca, naHtmlZTekstu, naTekstZHtml, normalizujUrl, parsujTagi, normalizujWzorce, posortujWzorce, filtrujWzorce,
  wartosciDostepnosci, zastosujWzorzecDostepnosci, POLA_DOSTEPNOSCI, wzorzecZnaDostepnosc, znajdzWzorzecPoNazwie,
  proponowaneGodziny,
} from '../logic.js';
import { parsujChipy, czyWidokDnia, zbierzChipyZeStrony } from '../kalendarz-dom.js';

const ICAL = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:1@test',
  'DTSTART;TZID=Europe/Warsaw:20260518T120000',
  'DTEND;TZID=Europe/Warsaw:20260518T133000',
  'SUMMARY:Rezerwacja 4os - Kowalski',
  'DESCRIPTION:tel 500 100 200\\nopłacone',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:2@test',
  'DTSTART;TZID=Europe/Warsaw:20260518T150000',
  'DTEND;TZID=Europe/Warsaw:20260518T160000',
  'SUMMARY:ANULOWANE 2os Nowak',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:3@test',
  'DTSTART;TZID=Europe/Warsaw:20260518T110000',
  'DTEND;TZID=Europe/Warsaw:20260518T120000',
  'SUMMARY:Urlop instruktor Adam',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:5@test',
  'DTSTART;TZID=Europe/Warsaw:20260518T110000',
  'DTEND;TZID=Europe/Warsaw:20260518T183000',
  'SUMMARY:2',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:4@test',
  'DTSTART;TZID=Europe/Warsaw:20260519T090000',
  'DTEND;TZID=Europe/Warsaw:20260519T100000',
  'SUMMARY:Inny dzień 2os',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('rozwijanie złamanych linii', () => {
  assert.equal(rozwinLinie('SUMMARY:abc\r\n def'), 'SUMMARY:abcdef');
});

test('parsowanie dat iCal', () => {
  assert.equal(parsujDateICal('20260518').calodniowe, true);
  assert.equal(parsujDateICal('20260518T120000Z').date.toISOString(), '2026-05-18T12:00:00.000Z');
  const lokalna = parsujDateICal('20260518T120000').date;
  assert.equal(lokalna.getHours(), 12);
});

test('parser iCal wyciąga eventy', () => {
  const e = parsujICal(ICAL);
  assert.equal(e.length, 5);   // + wydarzenie obsady „2"
  assert.equal(e[0].tytul, 'Rezerwacja 4os - Kowalski');
  assert.match(e[0].opis, /\n/);
  assert.equal(e[0].end.getHours(), 13);
});

test('filtr dnia', () => {
  assert.equal(eventyDnia(parsujICal(ICAL), '2026-05-18').length, 4);   // + obsada
});

test('klasyfikacja eventów', () => {
  const k = klasyfikujEventy(eventyDnia(parsujICal(ICAL), '2026-05-18'));
  const wg = Object.fromEntries(k.map((e) => [e.uid, e]));
  assert.equal(wg['1@test'].typ, 'rezerwacja');
  assert.equal(wg['1@test'].osoby, 4);
  assert.equal(wg['2@test'].typ, 'anulowana');
  assert.equal(wg['3@test'].typ, 'instruktor');
});

test('TAXI nadal liczone jako rezerwacja, ale oznaczone', () => {
  const [e] = klasyfikujEventy([{ tytul: 'TAXI 2os', opis: '', start: new Date(2026, 4, 18, 12), end: new Date(2026, 4, 18, 13), status: 'CONFIRMED', calodniowe: false, cykliczne: false }]);
  assert.equal(e.typ, 'rezerwacja');
  assert.match(e.uwagi.join(' '), /TAXI/);
});

test('tabela instruktorów (spec 1.0)', () => {
  assert.equal(liczbaInstruktorowDlaOsob(1), 1);
  assert.equal(liczbaInstruktorowDlaOsob(2), 1);
  assert.equal(liczbaInstruktorowDlaOsob(3), 2);
  assert.equal(liczbaInstruktorowDlaOsob(7), 2);
  assert.equal(liczbaInstruktorowDlaOsob(8), 3);
  assert.equal(liczbaInstruktorowDlaOsob(12), 3);
  assert.equal(liczbaInstruktorowDlaOsob(13), 4);
  assert.equal(liczbaInstruktorowDlaOsob(14), 4);
  assert.equal(liczbaInstruktorowDlaOsob(15), 5);
  assert.equal(liczbaInstruktorowDlaOsob(16), 6, '16+ to wartość stała, nie przeliczana');
  assert.equal(liczbaInstruktorowDlaOsob(40), 6);
  assert.equal(liczbaInstruktorowDlaOsob(0), 0);
});

test('godziny otwarcia (spec 1.0)', () => {
  assert.equal(godzinyOtwarciaDlaDnia('2026-05-18').odTekst, '11:00'); // poniedziałek
  assert.equal(godzinyOtwarciaDlaDnia('2026-05-18').doTekst, '18:30');
  assert.equal(godzinyOtwarciaDlaDnia('2026-05-19').odTekst, '12:00'); // wtorek
  assert.equal(godzinyOtwarciaDlaDnia('2026-05-22').doTekst, '19:30'); // piątek
  assert.equal(godzinyOtwarciaDlaDnia('2026-05-23').odTekst, '10:00'); // sobota
  assert.equal(godzinyOtwarciaDlaDnia('2026-05-17').doTekst, '18:30'); // niedziela
});

test('sloty: rezerwacja 4os zajmuje całą pulę (2 instruktorów)', () => {
  const w = wyznaczDostepneSloty({ eventy: parsujICal(ICAL), dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });
  const wg = Object.fromEntries(w.sloty.map((s) => [s.od, s]));
  assert.equal(wg['12:00'].dostepny, false, '12:00 zajęte przez rezerwację 4os');
  assert.equal(wg['13:30'].dostepny, true, '13:30 już wolne');
  assert.equal(wg['11:00'].dostepny, true, 'urlop zdejmuje 1 z 2 zadeklarowanych — dla 2 osób wystarczy 1');
  assert.equal(wg['15:00'].dostepny, true, 'event anulowany nie blokuje');
});

test('sloty: 4 osoby potrzebują pełnej pary instruktorów', () => {
  const w = wyznaczDostepneSloty({ eventy: parsujICal(ICAL), dataISO: '2026-05-18', osoby: 4, czasTrwaniaMin: 30 });
  const wg = Object.fromEntries(w.sloty.map((s) => [s.od, s]));
  assert.equal(wg['11:00'].dostepny, false, 'urlop blokuje grupę 4-osobową — zostaje 1 instruktor z 2');
  assert.equal(wg['13:30'].dostepny, true);
});

/* ── Propozycje godzin: pełna godzina ma pierwszeństwo, połówka jest awaryjna ── */

const EV = (tytul, od, doo) => ({
  uid: `${tytul}-${od}`, tytul, opis: '', calodniowe: false, cykliczne: false,
  start: new Date(`2026-05-18T${od}:00`), end: new Date(`2026-05-18T${doo}:00`),
});

test('propozycje: połówka wchodzi tylko tam, gdzie pełna godzina zajęta', () => {
  // 2 os. / 30 min = 1 instruktor. Obsada 1 na cały dzień, rezerwacja 13:00–13:30.
  const w = wyznaczDostepneSloty({
    eventy: [EV('1', '11:00', '18:30'), EV('2os Kowalski', '13:00', '13:30')],
    dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30,
  });
  // 13:00 zajęte → 13:30; po nim kursor wraca na pełne godziny.
  assert.deepEqual(w.proponowane, ['11:00', '12:00', '13:30', '14:00', '15:00', '16:00', '17:00', '18:00']);
});

test('propozycje: wizyta 60 min nie nachodzi na następną propozycję', () => {
  // 4 os. / 60 min = 2 instruktorów. Obsada 2, rezerwacja 2os zajmuje jednego 11:30–12:30.
  const w = wyznaczDostepneSloty({
    eventy: [EV('2', '11:00', '18:30'), EV('2os Nowak', '11:30', '12:30')],
    dataISO: '2026-05-18', osoby: 4, czasTrwaniaMin: 60,
  });
  // 11:00 i 11:30 zajęte, 12:00 też (obejmuje 12:00–12:30) → 12:30; koniec 13:30, więc dalej 14:00.
  assert.deepEqual(w.proponowane, ['12:30', '14:00', '15:00', '16:00', '17:00']);
});

test('propozycje: obie godziny zajęte → skok na następną pełną', () => {
  const sloty = [
    { od: '12:00', do: '12:30', dostepny: false },
    { od: '12:30', do: '13:00', dostepny: false },
    { od: '13:00', do: '13:30', dostepny: true },
  ];
  assert.deepEqual(proponowaneGodziny(sloty), ['13:00']);
  assert.deepEqual(proponowaneGodziny([]), []);
});

test('ostatni slot nie wychodzi poza godziny otwarcia', () => {
  const w = wyznaczDostepneSloty({ eventy: [], dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 60 });
  assert.equal(w.sloty[w.sloty.length - 1].do, '18:30');
});

test('brak wydarzenia z obsadą = zero instruktorów, nie domyślna pula', () => {
  // Kluczowa reguła spec 1.0: luka w grafiku znaczy „nikogo nie ma", nie „ktoś pewnie jest".
  const w = wyznaczDostepneSloty({ eventy: [], dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });
  assert.ok(w.sloty.length > 0, 'sloty są generowane');
  assert.ok(w.sloty.every((s) => !s.dostepny), 'żaden nie jest dostępny bez zadeklarowanej obsady');
  assert.ok(w.uwagi.some((u) => /obsad/i.test(u)), 'powód jest wprost w uwagach');
});

test('obsada obowiązuje tylko w swoim przedziale', () => {
  const eventy = parsujICal([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:o', 'DTSTART;TZID=Europe/Warsaw:20260518T110000',
    'DTEND;TZID=Europe/Warsaw:20260518T140000', 'SUMMARY:3', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const w = wyznaczDostepneSloty({ eventy, dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });
  const wg = Object.fromEntries(w.sloty.map((s) => [s.od, s]));
  assert.equal(wg['11:00'].wolniInstruktorzy, 3, 'w przedziale obsady');
  assert.equal(wg['13:30'].dostepny, true, 'slot kończący się równo z obsadą');
  assert.equal(wg['14:00'].wolniInstruktorzy, 0, 'po wygaśnięciu obsady — zero');
});

test('dzień zamknięty', () => {
  const stare = KONFIG.godzinyOtwarcia[1];
  KONFIG.godzinyOtwarcia[1] = null;
  const w = wyznaczDostepneSloty({ eventy: [], dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });
  assert.equal(w.otwarte, false);
  assert.match(sformatujDostepnosc(w), /nieczynna/);
  KONFIG.godzinyOtwarcia[1] = stare;
});

test('preferowana godzina', () => {
  const w = wyznaczDostepneSloty({ eventy: parsujICal(ICAL), dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });
  assert.equal(sprawdzDostepnoscSlotu(w, '12:00').dostepny, false);
  assert.equal(sprawdzDostepnoscSlotu(w, '13:30').dostepny, true);
  assert.equal(sprawdzDostepnoscSlotu(w, '12:10').dokladne, false);
});

test('formatowanie scala zakresy', () => {
  const w = wyznaczDostepneSloty({ eventy: parsujICal(ICAL), dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });
  const t = sformatujDostepnosc(w, '12:00');
  assert.match(t, /18\.05\.2026 \(poniedziałek\)/);
  assert.match(t, /Wolne przedziały/);
  assert.match(t, /ZAJĘTE/);
});

test('wykrywanie daty w tekście', () => {
  const dzis = new Date(2026, 4, 17);
  assert.equal(wykryjDateWTekscie('Czy jest wolne 18.05 o 14:00?', dzis).dataISO, '2026-05-18');
  assert.equal(wykryjDateWTekscie('Czy jest wolne 18.05 o 14:00?', dzis).godzina, '14:00');
  assert.equal(wykryjDateWTekscie('termin 18 maja 2026', dzis).dataISO, '2026-05-18');
  assert.equal(wykryjDateWTekscie('jutro', dzis).dataISO, '2026-05-18');
  assert.equal(wykryjDateWTekscie('brak daty', dzis).pewnosc, 'brak');
  assert.equal(wykryjDateWTekscie('18.05 albo 19.05', dzis).pewnosc, 'niska');
});

test('wydarzenia cykliczne są sygnalizowane, nie rozwijane', () => {
  const ical = ['BEGIN:VEVENT', 'UID:r@test', 'DTSTART;TZID=Europe/Warsaw:20260518T080000',
    'DTEND;TZID=Europe/Warsaw:20260518T090000', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Blok instruktor', 'END:VEVENT'].join('\r\n');
  const w = wyznaczDostepneSloty({ eventy: parsujICal(ical), dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });
  assert.match(w.uwagi.join(' '), /cykliczne/);
});

test('policzDostepnosc: pełny pipeline', () => {
  const w = policzDostepnosc({ tekstICal: ICAL, dataISO: '2026-05-18', osoby: 4, czasTrwaniaMin: 60, preferowanaGodzina: '12:00' });
  assert.equal(w.wymaganiInstruktorzy, 2);
  assert.ok(typeof w.tekst === 'string' && w.tekst.length > 0);
});

test('heurystyka polskiego', async () => {
  const { wygladaNaPolski } = await import('../logic.js');
  assert.equal(wygladaNaPolski('Dzień dobry, czy są wolne terminy w sobotę dla 4 osób? Pozdrawiam'), true);
  assert.equal(wygladaNaPolski('Hello, do you have any free slots on Saturday for four people? Best regards'), false);
  assert.equal(wygladaNaPolski('ok'), false);
});

/* ────────── Cache eventów (ochrona przed Resource::kQuotaBytes) ────────── */

test('kompaktujEventy: tnie okno czasowe i długie opisy', () => {
  const ical = [
    'BEGIN:VEVENT', 'UID:stare@test', 'DTSTART;TZID=Europe/Warsaw:20200518T120000',
    'DTEND;TZID=Europe/Warsaw:20200518T130000', 'SUMMARY:Archiwalna 2os', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:w-oknie@test', 'DTSTART;TZID=Europe/Warsaw:20260518T120000',
    'DTEND;TZID=Europe/Warsaw:20260518T133000', 'SUMMARY:Rezerwacja 4os',
    `DESCRIPTION:${'x'.repeat(5000)}`, 'END:VEVENT',
  ].join('\r\n');

  const kompaktne = kompaktujEventy(parsujICal(ical), { od: '2026-05-01', do: '2026-06-01' });
  assert.equal(kompaktne.length, 1, 'event spoza okna wypadł');
  assert.equal(kompaktne[0].uid, 'w-oknie@test');
  assert.equal(kompaktne[0].opis.length, MAX_OPIS_W_CACHE);
  assert.equal(typeof kompaktne[0].start, 'string', 'daty jako ISO — JSON-owalne');
  assert.ok(JSON.stringify(kompaktne).length < 2000, 'skompaktowany wpis jest mały');
});

test('odtworzEventy: round-trip nie zmienia wyniku pipeline\'u', () => {
  const eventy = parsujICal(ICAL);
  const bezposrednio = policzDostepnoscZEventow({ eventy, dataISO: '2026-05-18', osoby: 4, czasTrwaniaMin: 60 });
  const przezCache = policzDostepnoscZEventow({
    eventy: odtworzEventy(kompaktujEventy(eventy, { od: '2026-05-01', do: '2026-06-01' })),
    dataISO: '2026-05-18', osoby: 4, czasTrwaniaMin: 60,
  });
  assert.deepEqual(przezCache.sloty, bezposrednio.sloty);
  assert.equal(przezCache.tekst, bezposrednio.tekst);
});

test('czyWidokDnia — odczyt liczy się tylko z widoku pytanego dnia', () => {
  // Ścieżka dokładnie taka, jaką buduje `urlWidokuDnia` (bez zer wiodących).
  assert.equal(czyWidokDnia('/calendar/u/0/r/day/2026/5/18', '2026-05-18'), true);
  // Gdyby Google dopisał zera albo ogon — data nadal ta sama.
  assert.equal(czyWidokDnia('/calendar/u/0/r/day/2026/05/18', '2026-05-18'), true);
  assert.equal(czyWidokDnia('/calendar/u/0/r/day/2026/5/18/', '2026-05-18'), true);

  // Widok poprzedniego dnia — jego chipy nie mogą przejść za rezerwacje pytanej daty.
  assert.equal(czyWidokDnia('/calendar/u/0/r/day/2026/5/17', '2026-05-18'), false);
  // Kalendarz jeszcze nie przeszedł na widok dnia (miesiąc, ekran startowy, logowanie).
  assert.equal(czyWidokDnia('/calendar/u/0/r/month/2026/5/18', '2026-05-18'), false);
  assert.equal(czyWidokDnia('/calendar/u/0/r', '2026-05-18'), false);
  assert.equal(czyWidokDnia('', '2026-05-18'), false);
  assert.equal(czyWidokDnia(undefined, '2026-05-18'), false);
});

test('zbierzChipyZeStrony — zwraca chipy razem ze ścieżką, żeby dało się je umiejscowić', () => {
  // Funkcja jest serializowana do źródła i wykonywana w stronie Kalendarza, więc atrapujemy
  // tylko to, czego dotyka: `location.pathname` i `document.querySelectorAll`.
  const poprzedni = { location: globalThis.location, document: globalThis.document };
  globalThis.location = { pathname: '/calendar/u/0/r/day/2026/5/18' };
  globalThis.document = { querySelectorAll: () => [] };
  try {
    const wynik = zbierzChipyZeStrony();
    assert.equal(wynik.sciezka, '/calendar/u/0/r/day/2026/5/18');
    assert.deepEqual(wynik.chipy, []);
  } finally {
    globalThis.location = poprzedni.location;
    globalThis.document = poprzedni.document;
  }
});

test('parsujChipy: czas z widoku dnia → wydarzenia w kształcie iCal', () => {
  const chipy = [
    { czas: 'Od 12:00 do 13:30, Rezerwacja', tytul: '4os - GB 4xwyb / mail', aria: '' },
    { czas: '', tytul: 'Instruktorzy', aria: 'Od 10:00 do 19:30, 3' },
    { czas: 'Całodniowe', tytul: 'START', aria: '' },              // bez godzin — pomijane
    { czas: 'Od 14:00 do 15:00, x', tytul: '', aria: '' },          // bez tytułu — pomijane
  ];
  const e = parsujChipy(chipy, '2026-05-18');
  assert.equal(e.length, 2, 'tylko chipy z dwiema godzinami i tytułem');
  assert.equal(e[0].tytul, '4os - GB 4xwyb / mail');
  assert.equal(hhmm(e[0].start), '12:00');
  assert.equal(hhmm(e[0].end), '13:30');
  assert.equal(hhmm(e[1].start), '10:00', 'czas odczytany z aria-label, gdy brak spanu');
});

test('parsujChipy: wynik przechodzi przez klasyfikację tak samo jak iCal', () => {
  const e = parsujChipy([
    { czas: 'Od 10:00 do 19:30, x', tytul: 'Instruktor - urlop', aria: '' },
    { czas: 'Od 12:00 do 13:30, x', tytul: '4os - GB 4xwyb / mail', aria: '' },
    { czas: 'Od 15:00 do 16:00, x', tytul: 'Anulowane 2os', aria: '' },
  ], '2026-05-18');
  const k = klasyfikujEventy(e);

  assert.equal(k.filter((x) => x.typ === 'rezerwacja').length, 1);
  assert.equal(k.find((x) => x.typ === 'rezerwacja').osoby, 4, 'liczba osób z tytułu chipa');
  assert.equal(k.filter((x) => x.typ === 'instruktor').length, 1);
  assert.equal(k.filter((x) => x.typ === 'anulowana').length, 1, 'anulowane tak samo jak przy iCal');
});

test('polaczNaDzien: dzień z DOM-u wypiera cały dzień z iCal', () => {
  const zIcal = parsujICal([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:stary', 'DTSTART:20260518T120000Z', 'DTEND:20260518T133000Z',
    'SUMMARY:Rezerwacja odwolana w miedzyczasie', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:inny-dzien', 'DTSTART:20260519T120000Z', 'DTEND:20260519T130000Z',
    'SUMMARY:2os - inny dzien', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  const zDom = parsujChipy([{ czas: 'Od 16:00 do 17:00, x', tytul: '2os - nowa', aria: '' }], '2026-05-18');
  const polaczone = polaczNaDzien(zIcal, zDom, '2026-05-18');

  const tytuly = polaczone.map((e) => e.tytul);
  assert.ok(!tytuly.includes('Rezerwacja odwolana w miedzyczasie'), 'stary wpis z tego dnia znika');
  assert.ok(tytuly.includes('2os - nowa'), 'wpis z DOM-u jest');
  assert.ok(tytuly.includes('2os - inny dzien'), 'inne dni nietknięte');
});

test('numeryczny chip z Kalendarza deklaruje obsadę, tak samo jak z iCal', () => {
  // Ta reguła pochodzi wprost z widoku dnia (spec 1.0) — chip o tytule „4" to obsada,
  // więc odczyt na żywo musi dawać ten sam wynik co iCal.
  const e = parsujChipy([
    { czas: 'Od 11:00 do 18:30, x', tytul: '4', aria: '' },
    { czas: 'Od 12:00 do 13:30, x', tytul: '4os - GB', aria: '' },
  ], '2026-05-18');

  const k = klasyfikujEventy(e);
  const obsada = k.find((x) => x.typ === 'obsada');
  assert.ok(obsada, 'chip numeryczny rozpoznany jako obsada');
  assert.equal(obsada.liczba, 4);

  const w = wyznaczDostepneSloty({ eventy: e, dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30 });
  const wg = Object.fromEntries(w.sloty.map((s) => [s.od, s]));
  assert.equal(wg['12:00'].wolniInstruktorzy, 2, '4 na zmianie minus 2 zajęte przez grupę 4-osobową');
  assert.equal(wg['11:00'].wolniInstruktorzy, 4);
});

/* ────────────────────── Wzorce maili ────────────────────── */

test('polaWzorca — nazwy wstawek w kolejności, bez powtórzeń', () => {
  const t = 'Dzień dobry {{imie}},\npotwierdzam {{ data wizyty }} dla {{imie}}.';
  assert.deepEqual(polaWzorca(t), ['imie', 'data wizyty']);
  assert.deepEqual(polaWzorca('bez wstawek'), []);
  assert.deepEqual(polaWzorca('{{}} {{   }}'), []);
});

test('naHtmlZTekstu — akapity, łamania i escapowanie', () => {
  assert.equal(naHtmlZTekstu('a\nb'), '<div>a<br>b</div>');
  assert.equal(naHtmlZTekstu('a\n\nb'), '<div>a</div><div><br></div><div>b</div>');
  assert.equal(naHtmlZTekstu('<b>x</b> & y'), '<div>&lt;b&gt;x&lt;/b&gt; &amp; y</div>');
});

test('naTekstZHtml — znaczniki na tekst, encje odwrotnie', () => {
  assert.equal(naTekstZHtml('<div>a<br>b</div>'), 'a\nb');
  assert.equal(naTekstZHtml('<div>a</div><div><br></div><div>b</div>'), 'a\n\nb');
  assert.equal(naTekstZHtml('<b>Dzień</b> <u>dobry</u>'), 'Dzień dobry');
  assert.equal(naTekstZHtml('<ul><li>raz</li><li>dwa</li></ul>'), '• raz\n• dwa');
  assert.equal(naTekstZHtml('&lt;b&gt;x&lt;/b&gt; &amp; y&nbsp;z'), '<b>x</b> & y z');
  // Podwójnie zakodowane encje nie mają się rozwinąć w znacznik.
  assert.equal(naTekstZHtml('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
});

test('naTekstZHtml(naHtmlZTekstu(x)) === x — obieg w obie strony', () => {
  for (const t of ['Dzień dobry', 'a\nb', 'a\n\nb', '<b>x</b> & y']) {
    assert.equal(naTekstZHtml(naHtmlZTekstu(t)), t);
  }
});

test('parsujTagi — przecinki, średniki, bez duplikatów i pustych', () => {
  assert.deepEqual(parsujTagi(' rezerwacja , PL ;; wycena, '), ['rezerwacja', 'PL', 'wycena']);
  assert.deepEqual(parsujTagi('Wycena, wycena'), ['Wycena']);
  assert.deepEqual(parsujTagi(''), []);
});

test('normalizujWzorce — odsiewa śmieci i uzupełnia braki', () => {
  const out = normalizujWzorce([
    { id: 'a', nazwa: ' Powitanie ', tagi: ['pl'], tresc: 'Dzień dobry', zmieniono: 5 },
    { tresc: 'bez nazwy i id' },
    null,
    'nie obiekt',
  ]);
  assert.equal(out.length, 2);
  // Wpis bez `format` to stary plain text — migruje na HTML.
  assert.deepEqual(out[0], {
    id: 'a', nazwa: 'Powitanie', tagi: ['pl'],
    tresc: '<div>Dzień dobry</div>', format: 'html', zmieniono: 5,
  });
  assert.equal(out[1].nazwa, 'Bez nazwy');
  assert.equal(out[1].id, 'w-1');
  assert.deepEqual(out[1].tagi, []);
  assert.deepEqual(normalizujWzorce(undefined), []);
  // Wpis już w HTML-u zostaje nietknięty.
  const [gotowy] = normalizujWzorce([{ id: 'b', nazwa: 'X', tresc: '<div><b>hej</b></div>', format: 'html' }]);
  assert.equal(gotowy.tresc, '<div><b>hej</b></div>');
});

test('posortujWzorce — alfabetycznie po polsku, bez mutacji wejścia', () => {
  const wej = normalizujWzorce([{ nazwa: 'Świt' }, { nazwa: 'Cena' }, { nazwa: 'Ćma' }]);
  assert.deepEqual(posortujWzorce(wej).map((w) => w.nazwa), ['Cena', 'Ćma', 'Świt']);
  assert.deepEqual(wej.map((w) => w.nazwa), ['Świt', 'Cena', 'Ćma']);
});

test('filtrujWzorce — nazwa, tagi i treść; bez ogonków; wszystkie słowa frazy', () => {
  const wzorce = normalizujWzorce([
    { id: '1', nazwa: 'Potwierdzenie rezerwacji', tagi: ['klient'], format: 'html', tresc: '<div><b>Potwierdzam</b> termin.</div>' },
    { id: '2', nazwa: 'Prośba o zaliczkę', tagi: ['płatności'], format: 'html', tresc: '<div>Prosimy o wpłatę.</div>' },
  ]);
  assert.deepEqual(filtrujWzorce(wzorce, '').map((w) => w.id), ['1', '2']);
  assert.deepEqual(filtrujWzorce(wzorce, 'zaliczke').map((w) => w.id), ['2']);   // bez ogonka
  assert.deepEqual(filtrujWzorce(wzorce, 'platnosci').map((w) => w.id), ['2']);  // po tagu
  assert.deepEqual(filtrujWzorce(wzorce, 'potwierdzam termin').map((w) => w.id), ['1']); // po treści, mimo <b> w środku
  assert.deepEqual(filtrujWzorce(wzorce, 'div'), []);                                      // znaczniki nie są przeszukiwane
  assert.deepEqual(filtrujWzorce(wzorce, 'rezerwacji zaliczka'), []);            // AND, nie OR
});

/* ────────────────────── Wzorzec odpowiedzi o dostępności ────────────────────── */

test('wartosciDostepnosci — proponowane godziny i opis dnia', () => {
  const wynik = policzDostepnosc({
    tekstICal: ICAL, dataISO: '2026-05-18', osoby: 2, czasTrwaniaMin: 30,
  });
  const v = wartosciDostepnosci(wynik);

  assert.equal(v.data, '18.05.2026');
  assert.equal(v.dzien, 'poniedziałek');
  assert.equal(v.osoby, '2');
  assert.equal(v.czas, '30 min');
  assert.match(v.otwarcie, /^\d{2}:\d{2}–\d{2}:\d{2}$/);
  // Do klienta idą konkretne godziny — obie wstawki niosą tę samą listę.
  assert.match(v.terminy, /^\d{2}:\d{2}(, \d{2}:\d{2})*$/);
  assert.equal(v.godziny, v.terminy);
  // Każde pole z POLA_DOSTEPNOSCI ma wartość — inaczej wstawka zostałaby w mailu.
  for (const pole of POLA_DOSTEPNOSCI) assert.ok(v[pole], `brak wartości dla {{${pole}}}`);
});

test('wartosciDostepnosci — dzień bez wolnych miejsc i dzień zamknięty', () => {
  const zajety = policzDostepnosc({ tekstICal: ICAL, dataISO: '2026-05-18', osoby: 30, czasTrwaniaMin: 30 });
  assert.equal(wartosciDostepnosci(zajety).terminy, 'brak wolnych terminów');
  assert.equal(wartosciDostepnosci(zajety).godziny, 'brak wolnych terminów');

  // Dzień zamknięty: sloty puste, godziny null — wartości muszą się policzyć bez wyjątku.
  const zamkniety = { dataISO: '2026-05-18', otwarte: false, godziny: null, osoby: 2, czasTrwaniaMin: 30, sloty: [] };
  const v = wartosciDostepnosci(zamkniety);
  assert.equal(v.otwarcie, 'nieczynne');
  assert.equal(v.terminy, 'brak wolnych terminów');
});

test('zastosujWzorzecDostepnosci — podstawia znane pola, obce zostawia', () => {
  const wzorzec = '<div>Dzień dobry <b>{{imie}}</b>,</div><div>Na {{data}} ({{dzien}}) dla {{osoby}} os. mamy: <u>{{terminy}}</u>.</div>';
  const out = zastosujWzorzecDostepnosci(wzorzec, {
    imieNieistnieje: 'x', data: '18.05.2026', dzien: 'poniedziałek', osoby: '2', terminy: '12:00–13:00',
  });
  assert.equal(out,
    '<div>Dzień dobry <b>{{imie}}</b>,</div>' +
    '<div>Na 18.05.2026 (poniedziałek) dla 2 os. mamy: <u>12:00–13:00</u>.</div>');
});

test('zastosujWzorzecDostepnosci — wartości są escapowane, nie wstrzykują HTML-u', () => {
  const out = zastosujWzorzecDostepnosci('<div>{{terminy}}</div>', { terminy: '<img src=x onerror=alert(1)>' });
  assert.equal(out, '<div>&lt;img src=x onerror=alert(1)&gt;</div>');
});

test('zastosujWzorzecDostepnosci — wielkość liter i spacje we wstawce nie przeszkadzają', () => {
  assert.equal(zastosujWzorzecDostepnosci('{{ TERMINY }}', { terminy: '12:00' }), '12:00');
});

test('wzorzecZnaDostepnosc — wykrywa wstawkę na wynik', () => {
  assert.equal(wzorzecZnaDostepnosc('<div>wolne: {{terminy}}</div>'), true);
  assert.equal(wzorzecZnaDostepnosc('<div>{{ GODZINY }}</div>'), true);       // spacje i wielkość liter
  assert.equal(wzorzecZnaDostepnosc('<div>na {{data}} mamy miejsca</div>'), true);
  assert.equal(wzorzecZnaDostepnosc('<div>Dzień dobry {{imie}}</div>'), false); // sama wstawka ręczna nie wystarczy
  assert.equal(wzorzecZnaDostepnosc('<div>ttttttt</div>'), false);
  assert.equal(wzorzecZnaDostepnosc(''), false);
});

test('znajdzWzorzecPoNazwie — trafienie dokładne, ogonki i wielkość liter', () => {
  const w = normalizujWzorce([
    { id: '1', nazwa: 'Wzór - dostępność', format: 'html', tresc: '<div>{{terminy}}</div>' },
    { id: '2', nazwa: 'test', format: 'html', tresc: '<div>t</div>' },
  ]);
  assert.equal(znajdzWzorzecPoNazwie(w, 'Wzór - dostępność').wzorzec.id, '1');
  assert.equal(znajdzWzorzecPoNazwie(w, 'wzor - dostepnosc').wzorzec.id, '1');  // bez ogonków
  assert.equal(znajdzWzorzecPoNazwie(w, '  TEST  ').wzorzec.id, '2');           // spacje i wielkość liter
  assert.equal(znajdzWzorzecPoNazwie(w, 'test').status, 'znaleziony');
});

test('znajdzWzorzecPoNazwie — prefiks, brak, niejednoznaczność i pusta nazwa', () => {
  const w = normalizujWzorce([
    { id: '1', nazwa: 'Potwierdzenie rezerwacji', format: 'html', tresc: '<div>a</div>' },
    { id: '2', nazwa: 'Potwierdzenie zaliczki', format: 'html', tresc: '<div>b</div>' },
    { id: '3', nazwa: 'Anulacja', format: 'html', tresc: '<div>c</div>' },
  ]);
  // Jednoznaczny początek wystarczy — nie trzeba dopisywać nazwy do końca.
  assert.deepEqual(
    [znajdzWzorzecPoNazwie(w, 'anul').status, znajdzWzorzecPoNazwie(w, 'anul').wzorzec.id],
    ['prefiks', '3'],
  );
  const dwuznaczny = znajdzWzorzecPoNazwie(w, 'potwierdzenie');
  assert.equal(dwuznaczny.status, 'niejednoznaczny');
  assert.equal(dwuznaczny.wzorzec, null);
  assert.deepEqual(dwuznaczny.kandydaci, ['Potwierdzenie rezerwacji', 'Potwierdzenie zaliczki']);

  assert.equal(znajdzWzorzecPoNazwie(w, 'czegoś takiego nie ma').status, 'brak');
  assert.equal(znajdzWzorzecPoNazwie(w, '   ').status, 'pusto');
  assert.equal(znajdzWzorzecPoNazwie([], 'cokolwiek').status, 'brak');
});

test('znajdzWzorzecPoNazwie — zduplikowane nazwy dają pierwszy wzorzec i sygnał', () => {
  const w = normalizujWzorce([
    { id: '1', nazwa: 'dublet', format: 'html', tresc: '<div>a</div>' },
    { id: '2', nazwa: 'Dublet', format: 'html', tresc: '<div>b</div>' },
  ]);
  const r = znajdzWzorzecPoNazwie(w, 'dublet');
  assert.equal(r.status, 'duplikat');
  assert.equal(r.wzorzec.id, '1');
});

/* ────────────────────── Linki we wzorcach ────────────────────── */

test('normalizujUrl — uzupełnia schemat, rozpoznaje e-mail', () => {
  assert.equal(normalizujUrl('https://maps.google.com/x'), 'https://maps.google.com/x');
  assert.equal(normalizujUrl('  http://csa.pl  '), 'http://csa.pl');
  assert.equal(normalizujUrl('maps.google.com/maps/@50,19'), 'https://maps.google.com/maps/@50,19');
  assert.equal(normalizujUrl('www.csa.pl'), 'https://www.csa.pl');
  assert.equal(normalizujUrl('kontakt@csa.pl'), 'mailto:kontakt@csa.pl');
  assert.equal(normalizujUrl('mailto:kontakt@csa.pl'), 'mailto:kontakt@csa.pl');
});

test('normalizujUrl — odrzuca schematy spoza allowlisty i śmieci', () => {
  for (const zly of ['javascript:alert(1)', 'data:text/html,<b>x', 'ftp://plik.pl', 'file:///etc/passwd',
                     'http:bezukośników', 'zwykły tekst', '', '   ', null]) {
    assert.equal(normalizujUrl(zly), '', `powinno odrzucić: ${zly}`);
  }
});

test('naTekstZHtml — link oddaje adres, żeby nie zginął w wariancie tekstowym', () => {
  assert.equal(
    naTekstZHtml('<div>Dojazd: <a href="https://maps.google.com/x">Link do mapy</a></div>'),
    'Dojazd: Link do mapy (https://maps.google.com/x)',
  );
  // Gdy etykieta jest adresem, nie dublujemy go w nawiasie.
  assert.equal(naTekstZHtml('<a href="https://csa.pl">https://csa.pl</a>'), 'https://csa.pl');
  assert.equal(naTekstZHtml('<a href="mailto:a@b.pl">Napisz</a>'), 'Napisz (mailto:a@b.pl)');
  // Formatowanie wewnątrz etykiety nie psuje wyniku.
  assert.equal(naTekstZHtml('<a href="https://x.pl"><b>Mapa</b></a>'), 'Mapa (https://x.pl)');
});

test('filtrujWzorce — szuka też po adresie linku', () => {
  const w = normalizujWzorce([{ id: '1', nazwa: 'Dojazd', format: 'html',
    tresc: '<div><a href="https://maps.google.com/x">Link do mapy</a></div>' }]);
  assert.deepEqual(filtrujWzorce(w, 'maps.google').map((x) => x.id), ['1']);
  assert.deepEqual(filtrujWzorce(w, 'link do mapy').map((x) => x.id), ['1']);
});
