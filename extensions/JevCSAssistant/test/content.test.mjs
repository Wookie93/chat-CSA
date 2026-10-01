// Testy reguły wyboru wątku z content.js — uruchom: node --test test/content.test.mjs
//
// `content.js` nie jest modułem: MV3 wstrzykuje go jako klasyczny skrypt, więc nie da się go
// zaimportować. Ładujemy go w `node:vm` z atrapami `document`/`chrome` — tą samą metodą, co
// background.test.mjs atrapuje `chrome.*`.
//
// ZAKRES: sprawdzamy REGUŁĘ (co wygrywa: ID czy temat), nie selektory Gmaila. Selektory są
// nieoficjalne i nie da się ich zweryfikować poza przeglądarką (ograniczenie #1 ze spec).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const kontekst = {
  document: {
    addEventListener() {},
    querySelectorAll: () => [],
    getSelection: () => null,
    createElement: () => ({}),
    createRange: () => ({}),
  },
  chrome: { runtime: { onMessage: { addListener() {} } } },
  location: { href: 'https://mail.google.com/mail/u/0/#inbox' },
  Node: { ELEMENT_NODE: 1 },
  URL, setTimeout, clearTimeout,
};
vm.createContext(kontekst);
vm.runInContext(readFileSync(new URL('../content.js', import.meta.url), 'utf8'), kontekst);

const { znajdzWiersz, idWiersza, odczytajWatek, SEL } =
  vm.runInContext('({ znajdzWiersz, idWiersza, odczytajWatek, SEL })', kontekst);

const dokumentDomyslny = kontekst.document;

/**
 * Minimalna atrapa wiersza listy — tyle DOM-u, ile dotyka reguła wyboru.
 * `etykieta` nie jest częścią DOM-u; służy wyłącznie temu, żeby nietrafiony wybór był widoczny
 * w komunikacie błędu („oczekiwano B, dostano A") zamiast porównania dwóch identycznych atrap.
 */
function wiersz({ etykieta = '?', legacyId = null, dataThreadId = null, href = null, temat = '' }) {
  return {
    etykieta,
    getAttribute: (n) => (n === 'data-legacy-thread-id' ? legacyId : null),
    querySelector: (sel) => {
      if (sel === '[data-thread-id]') return dataThreadId ? { getAttribute: () => dataThreadId } : null;
      if (sel.startsWith('a[href')) return href ? { getAttribute: () => href } : null;
      if (sel === 'span[data-thread-id]') return null;
      if (sel === SEL.tematWListy) return { textContent: temat };
      return null;
    },
  };
}

const wybrany = (wiersze, kryteria) => znajdzWiersz(wiersze, kryteria)?.etykieta ?? null;

test('ID jest rozstrzygające — temat nie może wskazać innego wątku', () => {
  // Dokładnie zgłoszony przypadek: dwa wątki „Rezerwacja", pytamy o ten drugi.
  const lista = [
    wiersz({ etykieta: 'A', legacyId: 'ID_A', temat: 'Rezerwacja' }),
    wiersz({ etykieta: 'B', legacyId: 'ID_B', temat: 'Rezerwacja' }),
  ];

  assert.equal(wybrany(lista, { threadId: 'ID_B', temat: 'Rezerwacja' }), 'B');
  assert.equal(wybrany(lista, { threadId: 'ID_A', temat: 'Rezerwacja' }), 'A');
});

test('znane ID bez trafienia na liście nie podstawia wiersza o tym samym temacie', () => {
  const lista = [wiersz({ etykieta: 'A', legacyId: 'ID_A', temat: 'Rezerwacja' })];
  // Lista przeładowała się i żądanego wątku już na niej nie ma — lepiej nic niż cudzy wątek.
  assert.equal(wybrany(lista, { threadId: 'ID_B', temat: 'Rezerwacja' }), null);
});

test('bez ID decyduje temat, ale tylko gdy jest jednoznaczny', () => {
  const mieszana = [
    wiersz({ etykieta: 'cennik', temat: 'Pytanie o cennik' }),
    wiersz({ etykieta: 'rezerwacja', temat: 'Rezerwacja' }),
  ];
  assert.equal(wybrany(mieszana, { threadId: null, temat: 'Pytanie o cennik' }), 'cennik');

  const bliznieta = [
    wiersz({ etykieta: 'A', temat: 'Rezerwacja' }),
    wiersz({ etykieta: 'B', temat: 'Rezerwacja' }),
  ];
  assert.equal(wybrany(bliznieta, { threadId: null, temat: 'Rezerwacja' }), null,
    'dwa wątki o tym samym temacie są nie do rozstrzygnięcia — zgadywanie byłoby gorsze');

  assert.equal(wybrany(bliznieta, { threadId: null, temat: '' }), null);
});

test('ID wyciągane jest tak samo z każdego nośnika, jakiego używa skanowanie listy', () => {
  // Rozjazd między skanowaniem a otwieraniem (otwieranie pomijało adres) sprawiał, że
  // dopasowanie po ID po cichu nie trafiało i decydował temat.
  assert.equal(idWiersza(wiersz({ legacyId: 'ID_LEGACY' })), 'ID_LEGACY');
  assert.equal(idWiersza(wiersz({ dataThreadId: 'thread-f:1234567890' })), '1234567890');
  assert.equal(idWiersza(wiersz({ href: 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQbfXxyz' })), 'FMfcgzQbfXxyz');
  assert.equal(idWiersza(wiersz({ temat: 'Bez identyfikatora' })), '');

  const lista = [
    wiersz({ etykieta: 'legacy', legacyId: 'ID_A', temat: 'Rezerwacja' }),
    wiersz({ etykieta: 'zAdresu', href: 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQbfXxyz', temat: 'Rezerwacja' }),
  ];
  assert.equal(wybrany(lista, { threadId: 'FMfcgzQbfXxyz', temat: 'Rezerwacja' }), 'zAdresu');
});


/* ────────── Identyfikator wiadomości dla deduplikacji ────────── */

/** Atrapa kontenera wiadomości — tyle DOM-u, ile dotyka `odczytajWatek`. */
function wiadomoscDOM({ messageId = null, tekst = 'Dzień dobry, pytanie o termin.', nadawca = 'k@x.pl' } = {}) {
  const nosnik = messageId ? { getAttribute: (n) => (n === 'data-message-id' ? messageId : null) } : null;
  return {
    closest: () => nosnik,
    querySelector: (sel) => {
      if (sel === SEL.trescWiadomosci) return { textContent: tekst };
      if (sel === SEL.nadawca) return { getAttribute: () => nadawca, textContent: nadawca };
      if (sel.includes('data-message-id')) return nosnik;
      return null;
    },
  };
}

/**
 * Tablice zwrócone przez `odczytajWatek` powstają w realmie `vm`, więc mają inny `Array.prototype`
 * i `deepStrictEqual` odrzuciłby je mimo identycznej zawartości. `Array.from` przenosi je tutaj.
 */
const tutaj = (tablica, mapuj = (x) => x) => Array.from(tablica, mapuj);

/** Podstawia dokument z wątkiem na czas jednego odczytu. */
function zWatkiem(wiadomosci, { zwiniete = 0, tytul = 'Rezerwacja' } = {}, sprawdz = x => x) {
  kontekst.document = {
    addEventListener() {},
    querySelectorAll: (sel) => {
      if (sel === SEL.kontenerWiadomosci) return wiadomosci;
      if (sel === SEL.zwinieta) return new Array(zwiniete).fill({});
      return [];
    },
    querySelector: (sel) => (sel === SEL.tytulWatku ? { textContent: tytul } : null),
    getSelection: () => null,
    createElement: () => ({}),
    createRange: () => ({}),
  };
  try {
    return sprawdz(odczytajWatek());
  } finally {
    kontekst.document = dokumentDomyslny;
  }
}

test('odczytane ID wiadomości trafia do deduplikacji bez zmian', () => {
  const dane = zWatkiem([
    wiadomoscDOM({ messageId: 'msg-1' }),
    wiadomoscDOM({ messageId: 'msg-2' }),
  ]);
  assert.deepEqual(tutaj(dane.wiadomosci, (w) => w.id), ['msg-1', 'msg-2']);
  assert.equal(dane.ostatniaWiadomoscId, 'msg-2');
  assert.equal(dane.ostrzezenia.length, 0, 'komplet ID to sytuacja normalna, bez ostrzeżeń');
});

test('brak ID daje null i ostrzeżenie — nigdy numeru porządkowego', () => {
  const dane = zWatkiem([wiadomoscDOM(), wiadomoscDOM(), wiadomoscDOM()]);

  assert.deepEqual(tutaj(dane.wiadomosci, (w) => w.id), [null, null, null]);
  assert.equal(dane.ostatniaWiadomoscId, null, 'automat ma się zatrzymać, a nie dostać zmyślone ID');
  for (const w of dane.wiadomosci) {
    assert.ok(!/^idx-/.test(String(w.id)), 'pozycja na liście nie jest identyfikatorem');
  }
  assert.ok(dane.ostrzezenia.some((o) => /identyfikator/i.test(o)), 'powód widoczny dla operatora');
});

test('ta sama liczba widocznych wiadomości nie może dać tego samego ID dla innej treści', () => {
  // Sedno problemu: w długim wątku Gmail zwija starsze wiadomości, więc licznik widocznych staje
  // w miejscu mimo nowych odpowiedzi klienta. Numer porządkowy dawał wtedy raz za razem to samo
  // „idx-2", deduplikacja uznawała wątek za obsłużony i milkł on na zawsze.
  const przed = zWatkiem([
    wiadomoscDOM({ tekst: 'Pytanie o termin' }),
    wiadomoscDOM({ tekst: 'Nasza odpowiedź' }),
    wiadomoscDOM({ tekst: 'Dziękuję' }),
  ], { zwiniete: 3 });

  const po = zWatkiem([
    wiadomoscDOM({ tekst: 'Nasza odpowiedź' }),
    wiadomoscDOM({ tekst: 'Dziękuję' }),
    wiadomoscDOM({ tekst: 'A czy można przesunąć na sobotę?' }),   // nowa wiadomość klienta
  ], { zwiniete: 4 });

  assert.equal(przed.wiadomosci.length, po.wiadomosci.length, 'tyle samo widocznych wiadomości');
  assert.equal(przed.ostatniaWiadomoscId, null);
  assert.equal(po.ostatniaWiadomoscId, null);
  // Oba są `null`, więc semi-auto przerwie przetwarzanie zamiast uznać nową wiadomość za starą.
  // Gdyby zamiast tego wróciło „idx-2" w obu odczytach, wątek zostałby pominięty jako duplikat.
});

test('zwinięta część wątku jest sygnalizowana niezależnie od ID', () => {
  const dane = zWatkiem([
    wiadomoscDOM({ messageId: 'msg-1' }),
    wiadomoscDOM({ messageId: 'msg-2' }),
  ], { zwiniete: 5 });
  assert.equal(dane.ostatniaWiadomoscId, 'msg-2', 'zwinięcie nie blokuje automatu, gdy ID są');
  assert.ok(dane.ostrzezenia.some((o) => /zwinięta/i.test(o)));
});

test('chroniony zapis: nowy wątek i istniejący draft blokują wstawienie', () => {
  const { snapshotWatku, sprawdzZapis }=vm.runInContext('({ snapshotWatku, sprawdzZapis })',kontekst);
  zWatkiem([wiadomoscDOM({ messageId: 'msg-1' })], {}, current => {
  assert.match(sprawdzZapis('outdated',null),/zmienił/);
  assert.match(sprawdzZapis(snapshotWatku(current),{textContent:'Moja odpowiedź',querySelector:()=>null}),/Istniejący draft/);
  assert.equal(sprawdzZapis(snapshotWatku(current),{textContent:'',querySelector:()=>null}),null);
  assert.match(sprawdzZapis(snapshotWatku(current),{textContent:'',querySelector:()=>({})}),/Istniejący draft/);
  });
});
