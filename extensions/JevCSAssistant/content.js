/**
 * content.js — działa WYŁĄCZNIE na mail.google.com.
 * Nie hostuje żadnego UI. Robi dokładnie trzy rzeczy, na żądanie panelu/service workera:
 *   1. odczytuje treść otwartego wątku (ekstrakcja DOM),
 *   2. skanuje listę wątków (dla trybu semi-auto),
 *   3. wstrzykuje gotowy draft do pola odpowiedzi Gmaila.
 *
 * Selektory Gmaila są nieoficjalne (ograniczenie #1 ze spec) — zebrane w jednym miejscu poniżej.
 */

const SEL = {
  kontenerWiadomosci: 'div.gs',
  trescWiadomosci: 'div.a3s.aiL, div.a3s',
  nadawca: 'span.gD, span[email]',
  zwinieta: '.kv, .kQ',              // zwinięte wiadomości w wątku
  tytulWatku: 'h2.hP',
  wierszListy: 'tr.zA',
  wierszNieprzeczytany: 'tr.zA.zE',
  tematWListy: 'span.bog, .y6 span',
  nadawcaWListy: '.yW span[email], .yW span',
  przyciskOdpowiedz: '[role="button"][data-tooltip*="Odpowiedz"], [role="button"][aria-label*="Odpowiedz"], [role="button"][data-tooltip*="Reply"], span.ams.bkH',
  poleEdycji: 'div[role="textbox"][contenteditable="true"], div.Am.Al.editable',
};

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));

async function czekajNa(selektor, timeoutMs = 8000, korzen = document) {
  const doKiedy = Date.now() + timeoutMs;
  while (Date.now() < doKiedy) {
    const el = korzen.querySelector(selektor);
    if (el && el.offsetParent !== null) return el;
    await czekaj(150);
  }
  return null;
}

/** ID wątku z URL-a Gmaila: .../#inbox/FMfcgzQb... → FMfcgzQb... */
function idWatkuZUrl(url = location.href) {
  const hash = (url.split('#')[1] || '').split('?')[0];
  const czesci = hash.split('/').filter(Boolean);
  const ostatnia = czesci[czesci.length - 1] || '';
  return /^[A-Za-z0-9_-]{8,}$/.test(ostatnia) ? ostatnia : null;
}

function idWiadomosci(el) {
  const nosnik = el.closest('[data-message-id], [data-legacy-message-id]') ||
    el.querySelector('[data-message-id], [data-legacy-message-id]');
  if (!nosnik) return null;
  return nosnik.getAttribute('data-message-id') || nosnik.getAttribute('data-legacy-message-id');
}

function czysc(tekst) {
  return String(tekst || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Ekstrakcja treści otwartego wątku — wspólna dla 5.1, 5.3 i 5.4. */
function odczytajWatek() {
  const kontenery = Array.from(document.querySelectorAll(SEL.kontenerWiadomosci));
  const wiadomosci = [];

  for (const k of kontenery) {
    const tresc = k.querySelector(SEL.trescWiadomosci);
    if (!tresc) continue;
    const tekst = czysc(tresc.textContent);
    if (!tekst) continue;
    const nadawcaEl = k.querySelector(SEL.nadawca);
    wiadomosci.push({
      // `null`, a NIE numer porządkowy. Pozycja na liście nie jest identyfikatorem: zależy też od
      // tego, ile wiadomości Gmail zwinął, więc w długim wątku potrafi stanąć w miejscu mimo nowych
      // wiadomości. Deduplikacja semi-auto uznawałaby wtedy każdą kolejną odpowiedź klienta
      // za już obsłużoną i wątek milkł na zawsze. Brak ID ma zatrzymać automat, nie udawać ID.
      id: idWiadomosci(k) || null,
      nadawca: nadawcaEl ? (nadawcaEl.getAttribute('email') || nadawcaEl.textContent.trim()) : '',
      tekst,
    });
  }

  const zwiniete = document.querySelectorAll(SEL.zwinieta).length;

  return {
    threadId: idWatkuZUrl(),
    tytul: czysc(document.querySelector(SEL.tytulWatku)?.textContent) || '',
    url: location.href,
    wiadomosci,
    ostatniaWiadomoscId: wiadomosci.length ? wiadomosci[wiadomosci.length - 1].id : null,
    ostrzezenia: [
      ...(wiadomosci.length === 0
        ? ['Nie znaleziono żadnej wiadomości — otwórz wątek w Gmailu albo sprawdź, czy selektory nie uległy zmianie.']
        : []),
      ...(zwiniete > wiadomosci.length
        ? ['Część wiadomości w wątku jest zwinięta — kliknij „Rozwiń wszystkie", żeby odczytać pełną treść.']
        : []),
      // Odczyt ręczny działa bez ID (panel korzysta z samej treści), ale automat bez nich nie może
      // pracować — i musi o tym powiedzieć, zamiast po cichu liczyć na numer porządkowy.
      ...(wiadomosci.some((w) => !w.id)
        ? ['Nie udało się odczytać identyfikatorów wiadomości — tryb semi-auto pominie ten wątek (patrz README, ograniczenie #1).']
        : []),
    ],
  };
}

/** Link wiersza listy — nośnik adresu wątku. */
function linkWiersza(tr) {
  return tr.querySelector('a[href*="#"]') || tr.querySelector('span[data-thread-id]');
}

/**
 * Identyfikator wiersza listy. JEDNA implementacja dla skanowania i dla otwierania —
 * gdy te dwa miejsca wyciągały ID inaczej (otwieranie pomijało fallback na adres),
 * dopasowanie po ID po cichu nie trafiało i decydował temat.
 */
function idWiersza(tr) {
  const link = linkWiersza(tr);
  return tr.getAttribute('data-legacy-thread-id') ||
    (tr.querySelector('[data-thread-id]')?.getAttribute('data-thread-id') || '').replace(/^thread-f:/, '') ||
    (link?.getAttribute('href') ? idWatkuZUrl(link.getAttribute('href')) : null) ||
    '';
}

/**
 * Identyfikator wiersza w tej samej przestrzeni nazw, której używa `odczytajWatek` (ID z adresu).
 * `data-legacy-thread-id` to inne kodowanie tego samego wątku, więc do weryfikacji po nawigacji
 * nie nadaje się — porównanie dałoby fałszywą niezgodność przy każdym wątku.
 */
function idWierszaZUrl(tr) {
  const href = linkWiersza(tr)?.getAttribute('href');
  return href ? idWatkuZUrl(href) : null;
}

const tematWiersza = (tr) => czysc(tr.querySelector(SEL.tematWListy)?.textContent);

/** Lista wątków z aktualnego widoku listy (tryb semi-auto). */
function skanujListe({ tylkoNieprzeczytane = true } = {}) {
  const selektor = tylkoNieprzeczytane ? SEL.wierszNieprzeczytany : SEL.wierszListy;
  return Array.from(document.querySelectorAll(selektor)).map((tr) => {
    const href = linkWiersza(tr)?.getAttribute('href');
    return {
      threadId: idWiersza(tr) || null,
      temat: tematWiersza(tr),
      nadawca: czysc(tr.querySelector(SEL.nadawcaWListy)?.getAttribute?.('email') || tr.querySelector(SEL.nadawcaWListy)?.textContent),
      nieprzeczytany: tr.classList.contains('zE'),
      url: href ? new URL(href, location.origin).href : null,
    };
  }).filter((w) => w.threadId || w.url);
}

/**
 * Wiersz wątku do otwarcia.
 *
 * **ID jest rozstrzygające.** Wcześniejszy predykat przepuszczał dopasowanie po temacie także
 * wtedy, gdy ID było znane i NIE pasowało — więc przy dwóch wątkach „Rezerwacja" wygrywał
 * pierwszy z listy, a właściwy nie był otwierany nigdy.
 *
 * Temat służy wyłącznie jako awaryjne kryterium, gdy wiersz nie niesie żadnego ID, i tylko
 * wtedy, gdy wskazuje jednoznacznie. Dwa wątki o tym samym temacie są nie do rozstrzygnięcia —
 * zgadywanie oznaczałoby draft doklejony do cudzej korespondencji.
 */
function znajdzWiersz(wiersze, { threadId, temat }) {
  if (threadId) return wiersze.find((tr) => idWiersza(tr) === threadId) || null;
  if (!temat) return null;
  const pasujace = wiersze.filter((tr) => tematWiersza(tr) === temat);
  return pasujace.length === 1 ? pasujace[0] : null;
}

/** Otwiera wątek z listy (klik w wiersz) i zwraca jego treść — tryb semi-auto. */
async function otworzWatek({ threadId, temat }) {
  const wiersze = Array.from(document.querySelectorAll(SEL.wierszListy));
  const cel = znajdzWiersz(wiersze, { threadId, temat });
  if (!cel) {
    return { ok: false, blad: threadId
      ? `Nie znaleziono wiersza wątku ${threadId} — lista mogła się przeładować.`
      : `Nie da się jednoznacznie wskazać wątku „${temat || '(bez tematu)'}" — brak ID, a temat nie jest unikalny.` };
  }

  // Wzorzec do weryfikacji bierzemy PRZED kliknięciem: po nawigacji wiersza może już nie być.
  const oczekiwanyZUrl = idWierszaZUrl(cel);

  const klikalny = cel.querySelector(SEL.tematWListy) || cel.querySelector('.xY') || cel;
  klikalny.click();

  const gotowe = await czekajNa(SEL.kontenerWiadomosci, 10000);
  if (!gotowe) return { ok: false, blad: 'Wątek nie otworzył się w oczekiwanym czasie.' };
  await czekaj(400);

  const dane = odczytajWatek();
  // Sam wybór wiersza nie wystarczy: lista mogła się przeładować między odczytem a kliknięciem,
  // klik mógł trafić w sąsiedni wiersz, a Gmail mógł w ogóle nie zmienić widoku (wtedy czytalibyśmy
  // poprzedni wątek). Weryfikujemy tylko wtedy, gdy mamy wzorzec w TEJ SAMEJ przestrzeni nazw —
  // brak linku w wierszu znaczy „nie ma czym sprawdzić", nie „niezgodność".
  if (oczekiwanyZUrl && dane.threadId && dane.threadId !== oczekiwanyZUrl) {
    return { ok: false, blad: `Otworzył się inny wątek niż żądany (${dane.threadId} zamiast ${oczekiwanyZUrl}).` };
  }
  return { ok: true, dane };
}

/** Powrót z widoku wątku do listy. */
async function wrocDoListy() {
  history.back();
  const lista = await czekajNa(SEL.wierszListy, 8000);
  return { ok: !!lista };
}

/**
 * Ostatnia pozycja kursora w polu odpowiedzi.
 *
 * Kliknięcie przycisku w panelu bocznym zabiera fokus Gmailowi, a wstawiać trzeba dokładnie tam,
 * gdzie użytkownik zostawił kursor. Zaznaczenie zwykle przeżywa utratę fokusu, ale nie zawsze —
 * dlatego zapamiętujemy je na bieżąco, zamiast liczyć na odczyt w momencie wstawiania.
 */
let ostatniZakres = null;

document.addEventListener('selectionchange', () => {
  const sel = document.getSelection();
  if (!sel?.rangeCount) return;
  const wezel = sel.anchorNode;
  const el = wezel?.nodeType === Node.ELEMENT_NODE ? wezel : wezel?.parentElement;
  if (el?.closest?.(SEL.poleEdycji)) ostatniZakres = sel.getRangeAt(0).cloneRange();
});

/** Plain text → HTML w kształcie, jakiego oczekuje Gmail (trzyma treść jako HTML, nie tekst). */
function naAkapity(tekst) {
  return String(tekst)
    .split(/\n{2,}/)
    .map((akapit) => `<div>${akapit.split('\n').map(escapeHtml).join('<br>')}</div>`)
    .join('<div><br></div>');
}

/**
 * Gdzie wstawić: zapamiętany kursor, żywe zaznaczenie, a gdy kursora w tym polu nigdy nie było —
 * koniec istniejącej treści. Nigdy nie jest to „całe pole": podmiana zawartości kasowała wiadomość,
 * nad którą użytkownik już pracował.
 */
function zakresWstawienia(pole) {
  if (ostatniZakres && pole.contains(ostatniZakres.commonAncestorContainer)) return ostatniZakres;

  const sel = document.getSelection();
  if (sel?.rangeCount) {
    const zywy = sel.getRangeAt(0);
    if (pole.contains(zywy.commonAncestorContainer)) return zywy.cloneRange();
  }

  const koniec = document.createRange();
  koniec.selectNodeContents(pole);
  koniec.collapse(false);
  return koniec;
}

/** Wstawia HTML w podany zakres, zostawiając kursor za wstawioną treścią. */
function wstawWZakres(pole, html, zakres) {
  pole.focus();
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(zakres);

  // `insertHTML` trzyma się stosu cofania przeglądarki, więc po wstawieniu działa Ctrl+Z.
  const przed = pole.innerHTML;
  if (document.execCommand('insertHTML', false, html) && pole.innerHTML !== przed) return;

  // Awaryjnie ręcznie — `execCommand` bywa odmawiany, gdy dokument nie ma fokusu (a panel boczny
  // właśnie go zabrał). Bez cofania, ale zawsze skuteczne.
  const szablon = document.createElement('template');
  szablon.innerHTML = html;
  const ostatni = szablon.content.lastChild;
  zakres.deleteContents();
  zakres.insertNode(szablon.content);
  if (ostatni) {
    zakres.setStartAfter(ostatni);
    zakres.collapse(true);
    sel.removeAllRanges();
    sel.addRange(zakres);
  }
}

/**
 * Wstawia treść do pola odpowiedzi **w miejscu kursora**; Gmail zapisuje ją jako wersję roboczą.
 * `html` (wzorce z formatowaniem) jest już przepuszczony przez allowlistę w panelu —
 * `tekst` to zwykły plain text, który trzeba tu zescape'ować i rozbić na akapity.
 *
 * Do 2.3.0 wstawianie podmieniało `innerHTML` całego pola, czyli kasowało wszystko, co użytkownik
 * zdążył napisać — a wzorce są z założenia wstawiane do wiadomości w trakcie pisania.
 */
function snapshotWatku(d) {
  return JSON.stringify([d.threadId || '', d.ostatniaWiadomoscId || '', d.tytul || '',
    (d.wiadomosci || []).map(m => [m.id, m.nadawca, m.tekst])]);
}
function sprawdzZapis(expectedSnapshot, pole) {
  if (!expectedSnapshot || snapshotWatku(odczytajWatek()) !== expectedSnapshot) return 'Wątek zmienił się od analizy. Przeanalizuj go ponownie.';
  if (pole && (pole.textContent.trim() || pole.querySelector('img,table'))) return 'Istniejący draft lub podpis wymaga ręcznego wstawienia — nie nadpisano treści.';
  return null;
}
async function wstrzyknijDraft(tekst, html = '', guard = null) {
  let pole = document.querySelector(SEL.poleEdycji);

  if (guard) { const problem = sprawdzZapis(guard, pole); if (problem) return { ok: false, blad: problem }; }

  if (!pole) {
    const przycisk = await czekajNa(SEL.przyciskOdpowiedz, 5000);
    if (!przycisk) return { ok: false, blad: 'Nie znaleziono przycisku „Odpowiedz" — otwórz wątek w Gmailu.' };
    przycisk.click();
    pole = await czekajNa(SEL.poleEdycji, 8000);
  }
  if (!pole) return { ok: false, blad: 'Nie udało się otworzyć pola odpowiedzi.' };

  if (guard) { const problem = sprawdzZapis(guard, pole); if (problem) return { ok: false, blad: problem }; }
  wstawWZakres(pole, html || naAkapity(tekst), zakresWstawienia(pole));

  pole.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }));
  pole.dispatchEvent(new Event('change', { bubbles: true }));
  // Gmail zapisuje wersję roboczą po chwili bezczynności.
  await czekaj(2500);
  return { ok: true };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

chrome.runtime.onMessage.addListener((msg, _nadawca, odpowiedz) => {
  (async () => {
    try {
      switch (msg?.typ) {
        case 'PING':
          odpowiedz({ ok: true, gotowy: true, url: location.href });
          break;
        case 'ODCZYTAJ_WATEK':
          odpowiedz({ ok: true, dane: odczytajWatek() });
          break;
        case 'SKANUJ_LISTE':
          odpowiedz({ ok: true, watki: skanujListe(msg.opcje || {}) });
          break;
        case 'OTWORZ_WATEK':
          odpowiedz(await otworzWatek(msg.watek || {}));
          break;
        case 'WROC_DO_LISTY':
          odpowiedz(await wrocDoListy());
          break;
        case 'WSTRZYKNIJ_DRAFT':
          odpowiedz(await wstrzyknijDraft(msg.tekst || '', msg.html || '', msg.guarded ? (msg.expectedSnapshot || 'invalid') : null));
          break;
        default:
          odpowiedz({ ok: false, blad: `Nieznany typ wiadomości: ${msg?.typ}` });
      }
    } catch (e) {
      odpowiedz({ ok: false, blad: String(e && e.message ? e.message : e) });
    }
  })();
  return true; // odpowiedź asynchroniczna
});
