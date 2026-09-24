/**
 * kalendarz-dom.js — odczyt pojedynczego dnia wprost z UI Kalendarza Google.
 *
 * Po co, skoro jest iCal: eksport iCal to 47 MB i ~2 minuty, więc siłą rzeczy chodzi z cache'em
 * i bywa nieświeży. Tutaj czytamy **jeden dzień**, na żywo, w sekundy — do potwierdzania terminu,
 * kiedy cena pomyłki jest realna (ktoś zarezerwował slot kwadrans temu).
 *
 * Selektory pochodzą ze spec 1.0 i są NIEOFICJALNE — Google może je zmienić bez ostrzeżenia.
 * Dlatego to ścieżka pomocnicza, nigdy jedyna: gdy odczyt zawiedzie, liczymy z iCal.
 */

export const SEL_CHIP = '[data-eventchip]';
export const SEL_CZAS = '.XuJrye';     // span „Od HH:MM do HH:MM, …"
export const SEL_TYTUL = '.I0UMhf';    // kompaktowy tytuł, bez nazwy kalendarza i lokalizacji

/**
 * Wstrzykiwana do strony Kalendarza przez `chrome.scripting.executeScript`.
 * MUSI być samowystarczalna — jest serializowana do źródła, więc nie widzi importów
 * ani stałych z tego modułu. Stąd selektory powtórzone dosłownie.
 */
export function zbierzChipyZeStrony() {
  return {
    sciezka: location.pathname,
    chipy: Array.from(document.querySelectorAll('[data-eventchip]')).map((el) => ({
      czas: (el.querySelector('.XuJrye')?.textContent || '').trim(),
      tytul: (el.querySelector('.I0UMhf')?.textContent || '').trim(),
      aria: (el.getAttribute('aria-label') || '').trim(),
    })),
  };
}

/**
 * Czy odczyt pochodzi z widoku dnia, o który pytamy?
 *
 * `chrome.tabs.update` bywa pełnym przeładowaniem aplikacji Kalendarza, a zanim się skończy,
 * w DOM-ie siedzą chipy POPRZEDNIEGO widoku. Policzone jako rezerwacje pytanej daty byłyby
 * zwykłym błędem, więc każdy odczyt musi najpierw potwierdzić, gdzie jesteśmy.
 *
 * Wzorzec ścieżki jest nieoficjalny tak samo jak selektory chipów (ograniczenie #1 ze spec):
 * gdy Google go zmieni, warunek przestanie być spełniany, odczyt na żywo zacznie zawodzić
 * i dostępność policzy się z iCal — czyli tak, jak przed wprowadzeniem tej ścieżki.
 */
export function czyWidokDnia(sciezka, dataISO) {
  const m = /\/day\/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/.exec(String(sciezka || ''));
  if (!m) return false;
  const [rok, mies, dzien] = String(dataISO).split('-').map(Number);
  return Number(m[1]) === rok && Number(m[2]) === mies && Number(m[3]) === dzien;
}

/**
 * Surowe chipy → wydarzenia w tym samym kształcie, co zwraca parser iCal.
 * Czysta funkcja, bez DOM-u — cała wrażliwa logika jest tutaj i jest testowalna w Node.
 */
export function parsujChipy(chipy, dataISO) {
  const [rok, mies, dzien] = String(dataISO).split('-').map(Number);
  const eventy = [];

  for (const chip of chipy || []) {
    // Czas bierzemy z dedykowanego spanu, a gdy go brak — z aria-label, który niesie to samo.
    const zrodlo = chip.czas || chip.aria || '';
    const m = /(\d{1,2}):(\d{2})\D+?(\d{1,2}):(\d{2})/.exec(zrodlo);
    if (!m) continue;   // brak dwóch godzin = wydarzenie całodniowe albo nie chip terminu

    const start = new Date(rok, mies - 1, dzien, Number(m[1]), Number(m[2]), 0, 0);
    let end = new Date(rok, mies - 1, dzien, Number(m[3]), Number(m[4]), 0, 0);
    if (end <= start) end = new Date(end.getTime() + 24 * 3600e3);   // przekroczenie północy

    const tytul = chip.tytul || '';
    if (!tytul) continue;

    eventy.push({
      uid: `dom:${dataISO}:${tytul}:${m[1]}:${m[2]}`,
      tytul,
      opis: '',
      miejsce: '',
      start,
      end,
      calodniowe: false,
      status: 'CONFIRMED',
      cykliczne: false,
      tzid: null,
    });
  }

  return eventy;
}

/** Adres widoku dnia — dokładnie ten, którego używał spec 1.0. */
export function urlWidokuDnia(dataISO) {
  const [rok, mies, dzien] = String(dataISO).split('-').map(Number);
  return `https://calendar.google.com/calendar/u/0/r/day/${rok}/${mies}/${dzien}`;
}
