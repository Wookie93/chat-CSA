import { activeConfiguration } from './central/schema.mjs';
// sidepanel.js — całe UI rozszerzenia (natywny Side Panel API, panel po prawej).
// Nie zawiera logiki biznesowej: liczenie idzie do logic.js przez background.js,
// AI idzie do background.js, odczyt DOM Gmaila idzie do content.js.

import {
  naISO, wykryjDateWTekscie, wygladaNaPolski,
  polaWzorca, naTekstZHtml, naHtmlZTekstu, normalizujUrl, parsujTagi, normalizujWzorce, posortujWzorce, filtrujWzorce,
  wartosciDostepnosci, zastosujWzorzecDostepnosci, wzorzecZnaDostepnosc, znajdzWzorzecPoNazwie,
} from './logic.js';
import { zUstawieniami, KLUCZE_USTAWIEN, KLUCZ_WZORCOW } from './config.js';

const $ = (id) => document.getElementById(id);
const wyslij = (msg) => chrome.runtime.sendMessage(msg);

/* ───────────── Pomocnicze ───────────── */

/**
 * Awaria inicjalizacji musi być widoczna w panelu. Wcześniej wyjątek na górnym poziomie modułu
 * przerywał resztę startu po cichu — pusta lista wzorców wyglądała wtedy jak „funkcja nie działa".
 */
function bladStartu(gdzie, err) {
  console.error(`[asystent] Start — ${gdzie}:`, err);
  const el = $('banerBledu');
  el.textContent = `Błąd inicjalizacji (${gdzie}): ${err?.message || err}. Otwórz konsolę panelu (prawy klik → Zbadaj), żeby zobaczyć szczegóły.`;
  el.classList.remove('ukryty');
}

/** Krok startu, który nie przewraca kolejnych. */
async function bezpiecznie(gdzie, fn) {
  try { await fn(); } catch (err) { bladStartu(gdzie, err); }
}

function pasek(tekst, zle = false) {
  const el = $('pasek');
  el.textContent = tekst;
  el.classList.toggle('zle', zle);
  el.classList.remove('ukryty');
  clearTimeout(pasek._t);
  pasek._t = setTimeout(() => el.classList.add('ukryty'), 4000);
}

function pokazWynik(el, tekst, { blad = false, html = false } = {}) {
  el.classList.remove('ukryty');
  el.classList.toggle('blad', blad);
  if (html) el.innerHTML = tekst;
  else el.textContent = tekst;
}

async function zPrzyciskiem(btn, etykietaWTrakcie, fn) {
  const stara = btn.textContent;
  btn.disabled = true;
  btn.textContent = etykietaWTrakcie;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = stara;
  }
}

/** Aktywna karta Gmaila (panel boczny jest globalny, więc szukamy jej jawnie). */
async function kartaGmail() {
  const [aktywna] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (aktywna && /^https:\/\/mail\.google\.com\//.test(aktywna.url || '')) return aktywna;
  const [inna] = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  if (inna) return inna;
  throw new Error('Nie znaleziono karty Gmaila — otwórz mail.google.com.');
}

async function odczytajWatek() {
  const tab = await kartaGmail();
  let odp;
  try {
    odp = await chrome.tabs.sendMessage(tab.id, { typ: 'ODCZYTAJ_WATEK' });
  } catch {
    throw new Error('Karta Gmaila nie odpowiada — odśwież ją (F5) i spróbuj ponownie.');
  }
  if (!odp?.ok) throw new Error(odp?.blad || 'Nie udało się odczytać wątku.');
  const dane = odp.dane;
  if (!dane.wiadomosci.length) throw new Error(dane.ostrzezenia[0] || 'Wątek jest pusty — otwórz konkretny wątek.');
  return { dane, tabId: tab.id };
}

const tekstWatku = (dane) =>
  dane.wiadomosci.map((w, i) => `=== WIADOMOŚĆ ${i + 1}${w.nadawca ? ` (od: ${w.nadawca})` : ''} ===\n${w.tekst}`).join('\n\n');

/* ───────────── Zakładki ───────────── */

for (const z of document.querySelectorAll('.zakladka')) {
  z.addEventListener('click', () => {
    for (const inna of document.querySelectorAll('.zakladka')) inna.classList.remove('aktywna');
    for (const p of document.querySelectorAll('.panel')) p.classList.add('ukryty');
    z.classList.add('aktywna');
    $(`panel-${z.dataset.panel}`).classList.remove('ukryty');
    if (z.dataset.panel === 'semiauto') odswiezStatusSemiauto();
    if (z.dataset.panel === 'wzorce') $('wzorceSzukaj').focus();
  });
}

$('btnUstawienia').addEventListener('click', () => chrome.runtime.openOptionsPage());

/* ───────────── Baner konfiguracji ───────────── */

async function sprawdzKonfiguracje() {
  const u = zUstawieniami(await chrome.storage.local.get(KLUCZE_USTAWIEN));
  const braki = [];
  if (!u.apiKey) braki.push('klucz API OpenRouter');
  if (!u.icalUrl) braki.push('prywatny link iCal do Kalendarza');
  const baner = $('banerKonfig');
  if (braki.length) {
    baner.innerHTML = `Brakuje: ${braki.join(' i ')}. <a href="#" id="doUstawien">Otwórz Ustawienia</a>`;
    baner.classList.remove('ukryty');
    $('doUstawien').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  } else {
    baner.classList.add('ukryty');
  }
}

/* ───────────── 5.1 Policz pakiet ───────────── */

$('pakietZWatku').addEventListener('click', (e) =>
  zPrzyciskiem(e.target, 'Wczytuję…', async () => {
    try {
      const { dane } = await odczytajWatek();
      $('pakietWejscie').value = tekstWatku(dane);
      pasek(`Wczytano ${dane.wiadomosci.length} wiadomości.`);
    } catch (err) { pasek(err.message, true); }
  })
);

$('pakietLicz').addEventListener('click', (e) =>
  zPrzyciskiem(e.target, 'Liczę…', async () => {
    const tresc = $('pakietWejscie').value.trim();
    if (!tresc) return pasek('Wklej najpierw treść zapytania.', true);
    const odp = await wyslij({ typ: 'AI', funkcja: 'pakiet', tresc });
    if (!odp?.ok) return pokazWynik($('pakietWynik'), odp?.blad || 'Błąd wywołania modelu.', { blad: true });
    pokazWynik($('pakietWynik'), odp.tekst);
    if (odp.obciety) pasek('Model urwał odpowiedź na limicie tokenów — wycena może być niepełna.', true);
  })
);

/* ───────────── 5.2 Dostępność ───────────── */

$('dostData').value = naISO(new Date());

async function wykryjZWatku({ cicho = false } = {}) {
  const { dane } = await odczytajWatek();
  const ostatnia = dane.wiadomosci[dane.wiadomosci.length - 1].tekst;
  const w = wykryjDateWTekscie(`${dane.tytul}\n${ostatnia}`);
  const podp = $('dostepnoscWykrycie');

  if (!w.dataISO) {
    podp.textContent = 'Nie udało się wykryć daty w wątku — uzupełnij ręcznie.';
    podp.classList.remove('ukryty');
    if (!cicho) pasek('Brak daty w treści wątku.', true);
    return;
  }
  $('dostData').value = w.dataISO;
  if (w.godzina) $('dostGodzina').value = w.godzina;
  const mOsoby = /(\d{1,2})\s*os(?:\.|oby|ób|ob)?\b/i.exec(ostatnia);
  if (mOsoby) $('dostOsoby').value = mOsoby[1];

  podp.textContent =
    w.pewnosc === 'wysoka'
      ? `Wykryto datę ${w.dataISO}${w.godzina ? `, godz. ${w.godzina}` : ''} — sprawdź i popraw w razie potrzeby.`
      : `Niejednoznaczne daty w wątku: ${w.kandydaci.join(', ')}. Wstawiono pierwszą — zweryfikuj.`;
  podp.classList.remove('ukryty');
}

$('dostZWatku').addEventListener('click', (e) =>
  zPrzyciskiem(e.target, 'Szukam…', async () => {
    try { await wykryjZWatku(); } catch (err) { pasek(err.message, true); }
  })
);

let ostatniaOdpowiedz = null;   // { html, surowy } — wersja sprzed ręcznych poprawek

/** Wpisana nazwa wzorca wraca z ustawień; sam stan dopasowania liczy `odswiezStanWzorca`. */
async function odswiezWzorceDostepnosci() {
  const u = zUstawieniami(await chrome.storage.local.get(KLUCZE_USTAWIEN));
  if (!$('dostWzorzec').value) $('dostWzorzec').value = u.dostepnosc?.wzorzecNazwa || '';
  odswiezStanWzorca();
}

/** Wzorzec wskazany dla bieżącej zawartości pola — jedno źródło prawdy dla stanu i dla „Sprawdź". */
const wybranyWzorzec = () => znajdzWzorzecPoNazwie(wzorce, $('dostWzorzec').value);

/**
 * Bez listy rozwijanej trzeba powiedzieć wprost, co pole oznacza: czy nazwa trafiła we wzorzec,
 * jakie nazwy są w ogóle zapisane i czy wybrany wzorzec ma gdzie przyjąć godziny.
 */
function odswiezStanWzorca() {
  const { wzorzec, status, kandydaci } = wybranyWzorzec();
  const nazwy = wzorce.map((w) => w.nazwa);
  const spis = nazwy.length
    ? ` Zapisane wzorce: ${nazwy.slice(0, 6).join(', ')}${nazwy.length > 6 ? ', …' : ''}.`
    : ' Nie masz jeszcze żadnego wzorca — dodasz go w zakładce Wzorce.';

  const komunikat = {
    pusto: `Puste — wynik pokaże surową notatkę z kalendarza.${spis}`,
    znaleziony: `Wzorzec „${wzorzec?.nazwa}".`,
    prefiks: `Wzorzec „${wzorzec?.nazwa}" (dopasowany po początku nazwy).`,
    duplikat: `Kilka wzorców nazywa się tak samo — użyję pierwszego („${wzorzec?.nazwa}").`,
    niejednoznaczny: `Pasuje kilka wzorców: ${kandydaci.join(', ')}. Dopisz nazwę.`,
    brak: `Nie ma wzorca o takiej nazwie.${spis}`,
  }[status];
  $('dostWzorzecStan').textContent = komunikat;

  // Wzorzec bez wstawki na wynik podstawi się bez godzin — to wygląda jak brak reakcji, więc mówimy wprost.
  const bezWstawki = !!wzorzec && !wzorzecZnaDostepnosc(wzorzec.tresc);
  $('dostOstrzezenie').classList.toggle('ukryty', !bezWstawki);
  if (bezWstawki) {
    $('dostOstrzezenie').textContent =
      `Wzorzec „${wzorzec.nazwa}" nie zawiera żadnej wstawki na wynik. Dopisz w jego treści ` +
      `{{terminy}} lub {{godziny}} (zakładka Wzorce → Edytuj), inaczej godziny nie trafią do odpowiedzi.`;
  }
}

$('dostWzorzec').addEventListener('input', odswiezStanWzorca);

// Zapis dopiero po skończeniu pisania — nie chcemy zapisu na każdy znak.
$('dostWzorzec').addEventListener('change', async (e) => {
  const u = zUstawieniami(await chrome.storage.local.get(KLUCZE_USTAWIEN));
  await chrome.storage.local.set({ dostepnosc: { ...u.dostepnosc, wzorzecNazwa: e.target.value.trim() } });
});

/** „Przywróć" ma sens tylko wtedy, gdy treść faktycznie odbiega od wygenerowanej. */
function odswiezPrzywroc() {
  const zmieniona = !!ostatniaOdpowiedz && $('dostEdycja').innerHTML !== ostatniaOdpowiedz.html;
  $('dostPrzywroc').classList.toggle('ukryty', !zmieniona);
}

function pokazDostepnosc(wynik) {
  const wzorzec = wybranyWzorzec().wzorzec;
  // Bez wzorca pokazujemy notatkę operatora — z wzorcem gotowy mail, a notatka idzie pod „Szczegóły".
  const html = wzorzec
    ? zastosujWzorzecDostepnosci(wzorzec.tresc, wartosciDostepnosci(wynik))
    : naHtmlZTekstu(wynik.tekst);
  ostatniaOdpowiedz = { html, surowy: wynik.tekst };

  $('dostEdycja').innerHTML = html;
  $('dostSurowy').textContent = wynik.tekst;

  const zrodlo = wynik.zrodlo.zCache ? ' (z cache)' : '';
  const brakujace = polaWzorca(naTekstZHtml(html));
  $('dostZrodloTekst').textContent =
    `Kalendarz pobrany: ${new Date(wynik.zrodlo.pobrano).toLocaleString('pl-PL')}${zrodlo}.` +
    (brakujace.length ? ` Do uzupełnienia ręcznie: ${brakujace.join(', ')}.` : '');
  if (wzorzec && !wzorzecZnaDostepnosc(wzorzec.tresc)) {
    pasek(`Wzorzec „${wzorzec.nazwa}" nie ma wstawki {{terminy}} — godziny są tylko w „Szczegółach".`, true);
  }

  $('dostWynik').classList.add('ukryty');
  for (const id of ['dostNarzedzia', 'dostEdycja', 'dostZrodlo', 'dostSzczegoly', 'dostAkcje']) {
    $(id).classList.remove('ukryty');
  }
  odswiezPrzywroc();
}

function pokazBladDostepnosci(tekst) {
  ostatniaOdpowiedz = null;
  for (const id of ['dostNarzedzia', 'dostEdycja', 'dostZrodlo', 'dostSzczegoly', 'dostAkcje']) {
    $(id).classList.add('ukryty');
  }
  pokazWynik($('dostWynik'), tekst, { blad: true });
}

$('dostSprawdz').addEventListener('click', (e) =>
  zPrzyciskiem(e.target, 'Sprawdzam…', async () => {
    const dataISO = $('dostData').value;
    const osoby = Number($('dostOsoby').value);
    if (!dataISO) return pasek('Podaj datę.', true);
    if (!osoby || osoby < 1) return pasek('Liczba osób jest wymagana.', true);

    const odp = await wyslij({
      typ: 'DOSTEPNOSC',
      dataISO,
      osoby,
      czasTrwaniaMin: Number($('dostCzas').value) || 30,
      preferowanaGodzina: $('dostGodzina').value || null,
    });
    if (!odp?.ok) return pokazBladDostepnosci(odp?.blad || 'Błąd sprawdzania dostępności.');
    pokazDostepnosc(odp.wynik);
  })
);

$('dostEdycja').addEventListener('input', odswiezPrzywroc);

$('dostPrzywroc').addEventListener('click', () => {
  if (!ostatniaOdpowiedz) return;
  $('dostEdycja').innerHTML = ostatniaOdpowiedz.html;
  odswiezPrzywroc();
  pasek('Przywrócono wygenerowaną treść.');
});

/* Do schowka i do Gmaila idzie zawartość pola — łącznie z ręcznymi poprawkami. */

$('dostKopiuj').addEventListener('click', async () => {
  const html = $('dostEdycja').innerHTML;
  if (!naTekstZHtml(html)) return pasek('Pole jest puste.', true);
  await kopiujHtml(html);
  pasek('Skopiowano do schowka.');
});

$('dostWstaw').addEventListener('click', (e) =>
  zPrzyciskiem(e.target, 'Wstawiam…', async () => {
    const html = oczyscHtml($('dostEdycja').innerHTML);
    if (!naTekstZHtml(html)) return pasek('Pole jest puste.', true);
    try {
      const tab = await kartaGmail();
      const odp = await chrome.tabs.sendMessage(tab.id, { typ: 'WSTRZYKNIJ_DRAFT', html });
      pasek(odp?.ok ? 'Wstawiono w miejscu kursora.' : (odp?.blad || 'Nie udało się wstawić.'), !odp?.ok);
    } catch (err) { pasek(err.message, true); }
  })
);

/* ───────────── 5.3 Tłumacz wątek ───────────── */

$('tlumaczStart').addEventListener('click', (e) =>
  zPrzyciskiem(e.target, 'Tłumaczę…', async () => {
    try {
      const { dane } = await odczytajWatek();
      const u = zUstawieniami(await chrome.storage.local.get(KLUCZE_USTAWIEN));

      // Otwarte pytanie #2 ze spec: domyślnie wszystko idzie przez model (spójne formatowanie);
      // po włączeniu opcji polskie wiadomości są przepisywane lokalnie, bez kosztu tokenów.
      const doTlumaczenia = dane.wiadomosci.map((w, i) => ({ ...w, nr: i + 1 }))
        .filter((w) => !(u.tlumacz.pomijajPolskie && wygladaNaPolski(w.tekst)));
      const pominiete = dane.wiadomosci.length - doTlumaczenia.length;

      let odp = { ok: true, tekst: '', model: '(brak wywołania — wszystkie wiadomości po polsku)' };
      if (doTlumaczenia.length) {
        const tresc = doTlumaczenia
          .map((w) => `=== WIADOMOŚĆ ${w.nr}${w.nadawca ? ` (od: ${w.nadawca})` : ''} ===\n${w.tekst}`)
          .join('\n\n');
        odp = await wyslij({ typ: 'AI', funkcja: 'tlumacz', tresc });
      }
      if (!odp?.ok) return pokazWynik($('tlumaczWynik'), odp?.blad || 'Błąd tłumaczenia.', { blad: true });
      if (pominiete) {
        // Pominięte wiadomości dokładamy w oryginale, żeby wątek pozostał kompletny.
        const oryginaly = dane.wiadomosci
          .map((w, i) => ({ ...w, nr: i + 1 }))
          .filter((w) => !doTlumaczenia.some((d) => d.nr === w.nr))
          .map((w) => `=== WIADOMOŚĆ ${w.nr} ===\n${w.tekst}`);
        odp = { ...odp, tekst: [odp.tekst, ...oryginaly].filter(Boolean).join('\n\n') };
      }

      const czesci = odp.tekst.split(/^===\s*WIADOMOŚĆ\s*(\d+)[^=\n]*===\s*$/gim);
      let html = '';
      if (czesci.length > 1) {
        const bloki = [];
        for (let i = 1; i < czesci.length; i += 2) bloki.push({ nr: Number(czesci[i]), tekst: czesci[i + 1].trim() });
        bloki.sort((a, b) => a.nr - b.nr);
        for (const b of bloki) {
          const nadawca = dane.wiadomosci[b.nr - 1]?.nadawca || '';
          html += `<div class="wiadomosc"><h3>Wiadomość ${b.nr}${nadawca ? ` — ${escapeHtml(nadawca)}` : ''}</h3>${escapeHtml(b.tekst)}</div>`;
        }
      } else {
        html = escapeHtml(odp.tekst);
      }
      html += `<div class="wiadomosc"><h3>model: ${escapeHtml(odp.model)}</h3></div>`;
      pokazWynik($('tlumaczWynik'), html, { html: true });
      if (odp.obciety) pasek('Model urwał odpowiedź na limicie tokenów — końcówka wątku może być nieprzetłumaczona.', true);
      for (const o of dane.ostrzezenia) pasek(o, true);
    } catch (err) {
      pokazWynik($('tlumaczWynik'), err.message, { blad: true });
    }
  })
);

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* ───────────── 5.5 Wzorce maili ───────────── */

let wzorce = [];
let centralneWzorce = false;
let edytowanyId = null;   // null = edytor zamknięty, '' = nowy wzorzec
let doUsunieciaId = null; // pierwszy klik „Usuń" — drugi potwierdza

const IKONA_KOPIUJ = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="9" y="9" width="13" height="13" rx="2"></rect>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

/**
 * Treść wzorca idzie do `innerHTML` (podgląd w Gmailu, schowek), więc przechodzi przez allowlistę.
 * Sam edytor produkuje tylko bezpieczne znaczniki, ale wklejenie z dowolnej strony — już nie.
 * `DOMParser` daje dokument bezwładny: nic się nie wykonuje i nie dociąga zasobów.
 */
const DOZWOLONE_TAGI = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SPAN', 'A']);

// Te lecą razem z zawartością: rozpakowanie <script> wsadziłoby kod do wzorca jako widoczny tekst.
const DO_WYCIECIA = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'HEAD', 'META', 'LINK', 'TITLE']);

function oczyscHtml(html) {
  const dok = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const przejdz = (el) => {
    for (const dziecko of [...el.children]) {
      if (DO_WYCIECIA.has(dziecko.tagName)) { dziecko.remove(); continue; }
      przejdz(dziecko);
      if (!DOZWOLONE_TAGI.has(dziecko.tagName)) {
        dziecko.replaceWith(...dziecko.childNodes);   // znacznik znika, tekst zostaje
        continue;
      }
      for (const atrybut of [...dziecko.attributes]) {
        const dozwolony = dziecko.tagName === 'A' && atrybut.name.toLowerCase() === 'href';
        if (!dozwolony) dziecko.removeAttribute(atrybut.name);
      }
      if (dziecko.tagName === 'A' && !/^(https?:|mailto:)/i.test(dziecko.getAttribute('href') || '')) {
        dziecko.removeAttribute('href');
      }
    }
  };
  przejdz(dok.body);
  return dok.body.innerHTML;
}

async function wczytajWzorce() {
  const dane = await chrome.storage.local.get([KLUCZ_WZORCOW,'centralConnection','centralCache']);
  const central=activeConfiguration(dane);centralneWzorce=!!central;
  $('wzorzecNowy').disabled=centralneWzorce;
  $('wzorzecNowy').title=centralneWzorce?'Wzorce zarządzane centralnie. Zmiany wymagają publikacji w chat-CSA.':'';
  wzorce = posortujWzorce(normalizujWzorce(central ? central.replyTemplates : dane[KLUCZ_WZORCOW]).map(w=>({...w,tresc:oczyscHtml(w.tresc)})));
  rysujWzorce();
  odswiezWzorceDostepnosci();
}

const zapiszWzorce = () => chrome.storage.local.set({ [KLUCZ_WZORCOW]: wzorce });

function rysujWzorce() {
  const lista = $('wzorceLista');
  const widoczne = filtrujWzorce(wzorce, $('wzorceSzukaj').value);

  if (!widoczne.length) {
    lista.innerHTML = wzorce.length
      ? '<p class="pusto">Żaden wzorzec nie pasuje do wyszukiwania.</p>'
      : '<p class="pusto">Brak wzorców. Kliknij <strong>Nowy</strong> i zapisz pierwszą gotową odpowiedź — ' +
        'np. potwierdzenie rezerwacji albo prośbę o dane do wyceny. Miejsca zmienne zapisz jako <code>{{imie}}</code>.</p>';
    return;
  }

  lista.innerHTML = widoczne.map((w) => `
      <article class="wzorzec" data-id="${escapeHtml(w.id)}">
        <div class="naglowek">
          <strong>${escapeHtml(w.nazwa)}</strong>
          ${w.tagi.length ? `<span class="tagi">${escapeHtml(w.tagi.join(' · '))}</span>` : ''}
          <button class="ikona" data-akcja="kopiuj" type="button"
                  title="Kopiuj treść do schowka" aria-label="Kopiuj treść do schowka">${IKONA_KOPIUJ}</button>
        </div>
        <div class="rzad">
          <button class="wtorny maly" data-akcja="wstaw" type="button">Wstaw do odpowiedzi</button>
          <button class="wtorny maly" data-akcja="edytuj" type="button">Edytuj</button>
          <button class="wtorny maly${w.id === doUsunieciaId ? ' groznie' : ''}" data-akcja="usun" type="button">${
            w.id === doUsunieciaId ? 'Na pewno?' : 'Usuń'
          }</button>
        </div>
      </article>`).join('');
}

/** Do schowka lecą dwa warianty: HTML (zachowuje formatowanie) i plain text dla pól bez formatowania. */
async function kopiujHtml(html) {
  const tekst = naTekstZHtml(html);
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([tekst], { type: 'text/plain' }),
    })]);
  } catch {
    await navigator.clipboard.writeText(tekst);   // gdy przeglądarka odmówi zapisu wariantu HTML
  }
  return tekst;
}

async function kopiujWzorzec(w) {
  const doUzupelnienia = polaWzorca(await kopiujHtml(w.tresc));
  pasek(doUzupelnienia.length
    ? `Skopiowano. Do uzupełnienia: ${doUzupelnienia.join(', ')}.`
    : 'Skopiowano do schowka.');
}

function otworzEdytor(w) {
  edytowanyId = w ? w.id : '';
  $('wzorzecNazwa').value = w ? w.nazwa : '';
  $('wzorzecTagi').value = w ? w.tagi.join(', ') : '';
  $('wzorzecTresc').innerHTML = w ? w.tresc : '';
  $('wzorzecEdytor').classList.remove('ukryty');
  $('wzorzecNazwa').focus();
}

function zamknijEdytor() {
  edytowanyId = null;
  $('wzorzecEdytor').classList.add('ukryty');
}

/** Zaznaczenie ginie, gdy fokus przechodzi do formularza linku — trzymamy je na boku. */
function zakresWEdytorze(edytor) {
  const sel = document.getSelection();
  if (!sel?.rangeCount) return null;
  return edytor.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
}

function przywrocZakres(edytor, zakres) {
  edytor.focus();
  const sel = document.getSelection();
  sel.removeAllRanges();
  if (zakres) return sel.addRange(zakres);
  const koniec = document.createRange();          // brak zapamiętanego zakresu → kursor na koniec
  koniec.selectNodeContents(edytor);
  koniec.collapse(false);
  sel.addRange(koniec);
}

/** Kotwica obejmująca bieżące zaznaczenie — pozwala podmienić albo zdjąć istniejący link. */
function linkWZaznaczeniu(edytor) {
  const sel = document.getSelection();
  if (!sel?.rangeCount || !edytor.contains(sel.anchorNode)) return null;
  const wezel = sel.anchorNode;
  const el = wezel.nodeType === Node.ELEMENT_NODE ? wezel : wezel.parentElement;
  const a = el?.closest('a');
  return a && edytor.contains(a) ? a : null;
}

/** Pasek formatowania, wstawianie linków i bezpieczne wklejanie dla jednego pola contenteditable. */
function podepnijEdytor(idNarzedzi, idEdytora, idFormularza) {
  const edytor = $(idEdytora);
  const form = $(idFormularza);
  const pole = (nazwa) => form.querySelector(`[data-pole="${nazwa}"]`);
  const przycisk = (akcja) => form.querySelector(`[data-akcja="${akcja}"]`);
  let zapamietanyZakres = null;
  let edytowanaKotwica = null;

  const zamknijFormularz = () => {
    form.classList.add('ukryty');
    zapamietanyZakres = null;
    edytowanaKotwica = null;
  };

  function otworzFormularz() {
    const sel = document.getSelection();
    edytowanaKotwica = linkWZaznaczeniu(edytor);
    zapamietanyZakres = zakresWEdytorze(edytor);

    if (edytowanaKotwica) {
      // Kliknięcie w istniejący link edytuje go w całości, a nie fragment pod kursorem.
      const zakres = document.createRange();
      zakres.selectNode(edytowanaKotwica);
      zapamietanyZakres = zakres;
      pole('tekst').value = edytowanaKotwica.textContent;
      pole('url').value = edytowanaKotwica.getAttribute('href') || '';
    } else {
      pole('tekst').value = (sel && edytor.contains(sel.anchorNode)) ? String(sel).trim() : '';
      pole('url').value = '';
    }
    przycisk('usun').classList.toggle('ukryty', !edytowanaKotwica);
    form.classList.remove('ukryty');
    pole(pole('tekst').value ? 'url' : 'tekst').focus();
  }

  $(idNarzedzi).addEventListener('mousedown', (e) => {
    const btn = e.target.closest('[data-format], [data-link]');
    if (!btn) return;
    e.preventDefault();   // nie zabieraj zaznaczenia edytorowi
    if (!edytor.contains(document.getSelection()?.anchorNode)) edytor.focus();
    if (btn.hasAttribute('data-link')) otworzFormularz();
    else document.execCommand(btn.dataset.format);
  });

  form.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-akcja]');
    if (!btn) return;

    if (btn.dataset.akcja === 'anuluj') return zamknijFormularz();

    if (btn.dataset.akcja === 'usun') {
      przywrocZakres(edytor, zapamietanyZakres);
      document.execCommand('unlink');
      zamknijFormularz();
      return pasek('Link usunięty.');
    }

    const url = normalizujUrl(pole('url').value);
    if (!url) return pasek('Podaj adres w formie maps.google.com/…, https://… albo adres e-mail.', true);
    const etykieta = pole('tekst').value.trim() || url;

    przywrocZakres(edytor, zapamietanyZakres);
    document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(etykieta)}</a>`);
    zamknijFormularz();
    edytor.dispatchEvent(new Event('input'));   // „Przywróć" w Dostępności ma o tym wiedzieć
  });

  // Enter w polach formularza = wstawienie, Escape = rezygnacja.
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); przycisk('wstaw').click(); }
    if (e.key === 'Escape') { e.preventDefault(); zamknijFormularz(); }
  });

  // Wklejanie zachowuje formatowanie (np. z Gmaila), ale wyłącznie po przejściu przez allowlistę.
  $(idEdytora).addEventListener('paste', (e) => {
    const html = e.clipboardData.getData('text/html');
    e.preventDefault();
    if (html) document.execCommand('insertHTML', false, oczyscHtml(html));
    else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
}



$('wzorceSzukaj').addEventListener('input', rysujWzorce);
$('wzorzecNowy').addEventListener('click', () => otworzEdytor(null));
$('wzorzecAnuluj').addEventListener('click', zamknijEdytor);

$('wzorzecZapisz').addEventListener('click', async () => {
  await wczytajWzorce();
  if(centralneWzorce)return pasek('Wzorce są zarządzane centralnie.',true);
  const nazwa = $('wzorzecNazwa').value.trim();
  const tresc = oczyscHtml($('wzorzecTresc').innerHTML);
  if (!nazwa) return pasek('Podaj nazwę wzorca.', true);
  if (!naTekstZHtml(tresc)) return pasek('Wzorzec jest pusty.', true);

  const wpis = { nazwa, tagi: parsujTagi($('wzorzecTagi').value), tresc, format: 'html', zmieniono: Date.now() };
  const istniejacy = wzorce.find((w) => w.id === edytowanyId);
  if (istniejacy) Object.assign(istniejacy, wpis);
  else wzorce.push({ id: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ...wpis });

  wzorce = posortujWzorce(wzorce);
  await zapiszWzorce();
  zamknijEdytor();
  rysujWzorce();
  odswiezWzorceDostepnosci();
  pasek(istniejacy ? 'Wzorzec zaktualizowany.' : 'Wzorzec zapisany.');
});

$('wzorceLista').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-akcja]');
  if (!btn) return;
  const artykul = btn.closest('.wzorzec');
  const w = wzorce.find((x) => x.id === artykul.dataset.id);
  if (!w) return;

  const akcja = btn.dataset.akcja;
  const central=activeConfiguration(await chrome.storage.local.get(['centralConnection','centralCache']));
  if(central && ['edytuj','usun'].includes(akcja))return pasek('Wzorce są zarządzane centralnie.',true);
  // Wycofanie wiszącego potwierdzenia usuwania bez przerysowania listy — inaczej kliknięcie
  // w cokolwiek innego migałoby całą listą.
  if (akcja !== 'usun' && doUsunieciaId) {
    const czekajacy = $('wzorceLista').querySelector('[data-akcja="usun"].groznie');
    if (czekajacy) { czekajacy.textContent = 'Usuń'; czekajacy.classList.remove('groznie'); }
    doUsunieciaId = null;
  }

  switch (akcja) {
    case 'kopiuj':
      await kopiujWzorzec(w);
      break;

    case 'edytuj':
      otworzEdytor(w);
      break;

    case 'usun':
      if (doUsunieciaId !== w.id) { doUsunieciaId = w.id; rysujWzorce(); return; }
      wzorce = wzorce.filter((x) => x.id !== w.id);
      doUsunieciaId = null;
      if (edytowanyId === w.id) zamknijEdytor();
      await zapiszWzorce();
      rysujWzorce();
      odswiezWzorceDostepnosci();
      pasek(`Usunięto „${w.nazwa}".`);
      break;

    case 'wstaw':
      await zPrzyciskiem(btn, 'Wstawiam…', async () => {
        try {
          const tab = await kartaGmail();
          const odp = await chrome.tabs.sendMessage(tab.id, { typ: 'WSTRZYKNIJ_DRAFT', html: w.tresc });
          pasek(odp?.ok ? 'Wstawiono w miejscu kursora.' : (odp?.blad || 'Nie udało się wstawić.'), !odp?.ok);
        } catch (err) { pasek(err.message, true); }
      });
      break;
  }
});

/* ───────────── 5.4 Semi-auto ───────────── */

async function odswiezStatusSemiauto() {
  const u = zUstawieniami(await chrome.storage.local.get(KLUCZE_USTAWIEN));
  $('semiWlaczony').checked = !!u.semiauto.wlaczony;

  const odp = await wyslij({ typ: 'SEMIAUTO_STATUS' });
  if (!odp?.ok) return;

  const linie = [];
  linie.push(u.semiauto.wlaczony ? `Włączony, cykl co ${u.semiauto.interwalMin} min.` : 'Wyłączony.');
  linie.push(`Monitorowane wątki: ${u.semiauto.etykieta ? `etykieta „${u.semiauto.etykieta}", ` : ''}zapytanie „${u.semiauto.zapytanieGmail}".`);
  if (odp.alarm?.nastepny) linie.push(`Najbliższy cykl: ${new Date(odp.alarm.nastepny).toLocaleTimeString('pl-PL')}.`);
  if (odp.ostatniCykl) {
    const c = odp.ostatniCykl;
    linie.push(`Ostatni cykl (${new Date(c.czas).toLocaleString('pl-PL')}): sprawdzone ${c.sprawdzone}, draftów ${c.draftow}, pominięte (dedup) ${c.pominieteDedup}${c.przerwane ? `, przerwane wcześniej ${c.przerwane}` : ''}${c.bledy?.length ? `, błędy ${c.bledy.length}` : ''}.`);
    if (c.przerwane) {
      linie.push('Wątki „przerwane wcześniej" miały draft w przygotowaniu, gdy poprzedni cykl został ubity — ' +
        'sprawdź je w wersjach roboczych Gmaila. „Wyczyść dedup" pozwoli spróbować ponownie.');
    }
  }
  linie.push(`Wątków w mapie deduplikacji: ${odp.watkowWDedup}.`);
  $('semiStatus').textContent = linie.join('\n');

  $('semiLog').innerHTML = (odp.log || [])
    .map((w) => `<div class="${w.poziom === 'blad' ? 'blad' : ''}">${new Date(w.czas).toLocaleTimeString('pl-PL')} — ${escapeHtml(w.tekst)}</div>`)
    .join('') || '<div>Brak wpisów.</div>';
}

$('semiWlaczony').addEventListener('change', async (e) => {
  const u = zUstawieniami(await chrome.storage.local.get(KLUCZE_USTAWIEN));
  await chrome.storage.local.set({ semiauto: { ...u.semiauto, wlaczony: e.target.checked } });
  pasek(e.target.checked ? 'Tryb semi-auto włączony.' : 'Tryb semi-auto wyłączony.');
  setTimeout(odswiezStatusSemiauto, 300);
});

$('semiTeraz').addEventListener('click', (e) =>
  zPrzyciskiem(e.target, 'Pracuję…', async () => {
    const odp = await wyslij({ typ: 'SEMIAUTO_TERAZ' });
    if (!odp?.ok) pasek(odp?.powod || odp?.blad || 'Cykl nie wystartował.', true);
    else pasek(`Cykl zakończony: ${odp.draftow} draftów, ${odp.pominieteDedup} pominiętych${odp.przerwane ? `, ${odp.przerwane} przerwanych wcześniej` : ''}.`, odp.bledy?.length > 0);
    odswiezStatusSemiauto();
  })
);

$('semiReset').addEventListener('click', async () => {
  await wyslij({ typ: 'SEMIAUTO_RESET_DEDUP' });
  pasek('Mapa deduplikacji wyczyszczona.');
  odswiezStatusSemiauto();
});

/* ───────────── Start ───────────── */

async function start() {
  // `execCommand` jest formalnie przestarzałe, ale w contenteditable pozostaje jedynym API,
  // które Chrome faktycznie wspiera — i daje czyste <b>/<i>/<u> zamiast spanów ze stylami.
  await bezpiecznie('edytory', () => {
    document.execCommand('styleWithCSS', false, false);
    podepnijEdytor('wzorzecNarzedzia', 'wzorzecTresc', 'wzorzecLink');
    podepnijEdytor('dostNarzedzia', 'dostEdycja', 'dostLink');
  });
  await bezpiecznie('wzorce', wczytajWzorce);
  await bezpiecznie('konfiguracja', sprawdzKonfiguracje);
  chrome.storage.onChanged.addListener(sprawdzKonfiguracje);
  chrome.storage.onChanged.addListener((c,area)=>{if(area==='local' && (c.centralCache || c.centralConnection || c.wzorce)){zamknijEdytor();wczytajWzorce().catch(e=>pasek(e.message,true));}});
}

start();
