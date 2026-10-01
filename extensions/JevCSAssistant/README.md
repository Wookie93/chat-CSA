# JevCSAssistant 0.2.0

Centralna konfiguracja i nowa ścieżka instalacji: [instrukcja](../../CENTRAL_CONFIGURATION.md). W tym repo instaluj katalog `extensions/JevCSAssistant`; starsze ścieżki poniżej opisują bazową wersję projektu.

Osobna wersja rozszerzenia Chrome MV3: Jev interpretuje wątek i zamówienia, kod liczy ceny i dostępność, wzorzec tworzy odpowiedź, a operator sprawdza draft. Źródłowa wtyczka w katalogu głównym pozostaje osobną instalacją.

## Instalacja i pierwsze uruchomienie

1. Otwórz `chrome://extensions`, włącz tryb dewelopera i wybierz „Wczytaj rozpakowane”.
2. Wskaż **`/home/lukasz-t/projekty/asystent-klienta/versions/JevCSAssistant`**.
3. W ustawieniach wprowadź klucz OpenRouter i prywatny link iCal. Wybierz dwie reguły dostępności; do ich wskazania kalendarz nie podaje godzin. Nowe ID rozszerzenia oznacza oddzielny magazyn ustawień; nie przejmujemy sekretów starej instalacji.
4. Otwórz Gmail i odśwież kartę, aby załadować content script. W panelu „Jev — obsługa maila” wybierz „Wczytaj wątek”, potem „Analizuj i przygotuj odpowiedź”. Możesz też wkleić tekst do wyceny, ale zapis draftu wymaga powiązania z odczytanym wątkiem.
5. Sprawdź zamówienie, cenę, datę i czas wizyty. Edycja pól lub koszyka unieważnia odpowiedź do czasu ponownego przeliczenia.
6. „Wstaw draft do wątku” zapisuje tekst do edytora Gmaila, bez wysyłania. Sprawdź zapis w Gmailu. Istniejąca treść/podpis i zmieniony wątek blokują automatyczne wstawienie; możesz skopiować odpowiedź ręcznie.

Semi-auto jest domyślnie wyłączony, a tryb porównawczy włączony. Po jego uruchomieniu wtyczka analizuje, ale nie tworzy draftów. Wyłączenie trybu porównawczego pozwala zapisywać drafty standardowych spraw. Przed uruchomieniem wyłącz semi-auto poprzedniej wtyczki — deduplikacja nie jest współdzielona między instalacjami.

## Co zostało wdrożone

- API Decisions OpenRouter, model domyślny `typesafe/jev-1.13`, konfigurowalny w ustawieniach.
- Wspólny pierwszy request: triaż, parametry wizyty, język, liczba osób/zestawów i produkty występujące w zamówieniu.
- Drugi etap: dokładne ilości wybranych produktów dla każdej osoby. Duże zestawy są dzielone według limitu rozmiaru, bez obcinania osób.
- Maksymalnie 30 osób, 100 produktów katalogu, 8 logicznych wywołań na analizę, 45 s budżetu analizy. Przekroczenie wymaga ręcznej obsługi, nie skracania zamówienia.
- Wycena deterministyczna, kompletne podsumowanie per osoba i sumy grupy; ceny liczone w groszach za bazową liczbę strzałów.
- Adapter kalendarza wykorzystujący iCal i pomocniczy odczyt własnej karty w tle. Istniejąca karta użytkownika nie jest nawigowana.
- Wzorce PL/EN konfigurowane w ustawieniach: `{{wycena}}`, `{{dostepnosc}}`, `{{pytania}}`. Standardowa odpowiedź nie wymaga LLM.
- Opcjonalny przycisk dodający przez tekstowy LLM powitanie/zakończenie. Blok danych jest wstawiany po generowaniu i pozostaje niezmieniony; redakcja wymaga ręcznego sprawdzenia i nie działa w semi-auto.
- Wspólna kolejka zapisu draftów dla panelu i automatu, trwała deduplikacja, ponowne sprawdzenie treści wątku, ochrona istniejącego draftu.
- Koszt i czasy etapów w panelu; koszt nieznany oznaczany jako nieznany. Tryb porównawczy pamięta przeanalizowane wersje wątków, aby nie płacić ponownie w każdym cyklu.
- Zachowane ręczne narzędzia: dostępność, tłumaczenie, biblioteka wzorców. „Policz pakiet” korzysta już z Jev i kalkulatora.

## Cennik użytkownika

Wbudowany katalog `catalog/csa-catalog.json` / `catalog/csa-catalog.js` powstał na podstawie pliku `/home/lukasz-t/Pulpit/prompt-cennik`, przekazanego w tej rozmowie. Zawiera 7 pakietów i 55 pozycji broni; warianty pisowni PPSz/PPSh są aliasami jednej pozycji.

Reguły:

- Basic 200 zł; Basic+ 250 zł; Premium 320 zł; Premium+ 380 zł; VIP 430 zł; Like a king 500 zł; Badass 550 zł.
- Ilość strzałów musi być wielokrotnością bazowej ilości danej broni. Przykład: Glock 10/20/30, Colt 1911 7/14/21.
- Cena = cena bazowa × liczba pełnych bloków. Dzięki temu 14 strzałów Colta po 60 zł za 7 daje dokładnie 120 zł.
- Do zestawu każdej osoby doliczane jest 90 zł, chyba że zawiera gotowy pakiet. Gotowy pakiet z dodatkowymi broniami również nie ma drugiej opłaty 90 zł.
- Sama lista bez podziału na osoby jest jednym zestawem do wyceny. Nie jest to dowód liczby uczestników dla kalendarza.
- Błędna wielokrotność daje komunikat „Błędna liczba strzałów” z bronią i ilością, bez finalnej kwoty.
- Nieznany produkt, niedoprecyzowana ilość lub niepewne przypisanie nie są wyceniane jako zero.
- Nie dodano nieudokumentowanych rabatów ani czasu wizyty zależnego od strzałów. Ilości powyżej skonfigurowanego zakresu wymagają rozszerzenia katalogu/ręcznej obsługi.

`priceGrosz` dotyczy `baseQuantity`, nie pojedynczego strzału. `quantities` wylicza obsługiwane ilości. `serviceFeeGrosz` jest opłatą per zestaw. Opcjonalne `durationMin` i `durationRule: "maxParticipantSum"` wolno włączyć tylko po potwierdzeniu rzeczywistych zasad czasu; katalog dostarczony przez użytkownika nie określa tych zasad.

## Dostępność: reguły i źródła

Plik `/home/lukasz-t/Pulpit/dostepnosc` określa tabelę instruktorów 1/2/3/4/5/6 oraz preferowanie pełnych godzin przed połówkami. Dla godzinnej wizyty pokazuje 12:30, potem 14:00.

Przeanalizowano także `versions/asystent-klienta-jev-prototype/dzien-prototyp.js`. Prototyp zawiera dodatkowy model, w którym liczby oznaczają już wolnych instruktorów i rezerwacji nie odejmuje się ponownie. Prototyp dopuszcza też starty w każdej kolejnej godzinie i wizytę kończącą się po tabelarycznej godzinie zamknięcia, jeśli kalendarz pokrywa cały czas.

`tools/availability.js` obsługuje oba modele; oczekujące rozstrzygnięcia opisano w `STATUS-MIGRACJI.md`. W modelu wolnej obsady przeniesiono sens reguły prototypu, ale sprawdzanie pokrycia używa dokładnych granic wydarzeń: wpis 12:15–13:00 nie wystarcza dla wizyty 12:00–13:00. Znaczniki START/KONIEC/JDG nie obciążają grafiku; START 4os nadal jest rozpoznawany jako rezerwacja.

Obecne iCal/DOM nie dają weryfikacji kompletności identycznej z pełną pętlą prototypu. Wynik nowego przepływu jest więc **wstępny**, z widocznym źródłem i wiekiem. Wzorzec nie potwierdza rezerwacji. Awaria kalendarza pozostawia poprawną wycenę, ale nie podaje wolnych godzin.

## Konfiguracja, import i dane

Ustawienia pozwalają zmienić katalog, próg pewności Jev i wzorce. Import konfiguracji Jev trafia najpierw do formularza i wyłącza automaty. Eksport pomija klucz API, link iCal i historyczne prompty; zawiera konfigurację katalogu i wzorców. Dawne ręcznie edytowane prompty wyceny nie są źródłem cen dla kalkulatora.

Do Jev trafia tekst wątku, temat oraz katalog. Linki, e-maile, numery telefonów i znane sekrety są redagowane; nie jest to pełna anonimizacja nazwisk. Nie wysyłamy cookies ani linku iCal w kontekście. Nie przesyłamy całego kalendarza do Jev. Stan analizy ręcznej jest w pamięci panelu; logi metryk nie zawierają pełnego maila.

## Testowanie

```bash
cd /home/lukasz-t/projekty/asystent-klienta/versions/JevCSAssistant
npm test
```

Szczegółowe wyniki pojedynczej grupy: `node test/jev-pipeline.test.mjs` (analogicznie `logic`, `content`, `background`). Testy nie wymagają klucza ani dostępu do Gmaila. Pełny zestaw zawiera testy timeoutów i trwa około 2 minut.

`test/preview.html` i `test/preview-mock.js` są osobnym podglądem panelu na atrapach Chrome/API. Można go uruchomić lokalnym serwerem HTTP. Wyraźnie pokazuje TEST UI; nie testuje prawdziwego modelu, sesji Google ani zapisu Gmaila.

## Granice wydania

To wersja do ręcznego pilotażu. Nie przeprowadzono jeszcze płatnego testu rzeczywistego Jev, testu zapisów w roboczym Gmailu ani porównania jakości na oznaczonej próbce korespondencji. Nie deklarujemy procentowej trafności ani przyspieszenia bez tych pomiarów.

Jev ma pytania o autora ostatniej wiadomości, ale integracja Gmaila nie dostarcza wiarygodnie roli nadawcy i czasu wysłania. Daty względne bez kontekstu, brak roku, zwinięte wątki, zmiany rezerwacji, reklamacje i nietypowe reguły trafiają do sprawdzenia. Obsługiwany jest domyślny adres konta Google `/u/0`; wiele kont/kalendarzy wymaga ręcznej weryfikacji źródła.

Brak czasu wizyty blokuje automatyczne sprawdzenie terminu. Uzupełnij go w panelu; nie zakładamy 30 minut dla każdej grupy. Nawigacja Jev po Kalendarzu i automatyczny zapis rezerwacji pozostają osobnym dalszym etapem.

## Powrót do starej wersji

Wyłącz semi-auto JevCSAssistant i poczekaj na zakończenie cyklu. Sprawdź drafty o niepewnym wyniku zapisu, a następnie wyłącz nowe rozszerzenie. Włącz poprzednią instalację i dopiero wtedy jej automat. Nie usuwaj automatycznie draftów ani nie resetuj deduplikacji, zanim sprawdzisz Gmail.

## Dokumentacja API

- https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request
- https://docs.typesafe.ai/primitives
- https://docs.typesafe.ai/confidence

Endpoint i format sprawdzono w dokumentacji 21.09.2026. To API alpha; lokalne testy atrap nie zastępują testu autoryzowanego żądania.

## Ocena rzeczywistego modelu

Przycisk „Testuj zapisany klucz i model Jev” w ustawieniach wykonuje krótką próbę API na sztucznym powitaniu, bez maila klienta. Wymaga zapisanego klucza i zużywa tokeny.

`scripts/evaluate.mjs` pozwala wykonać płatną ocenę wybranego pliku wiadomości na realnym Jev. Przykłady syntetyczne znajdują się w `test/evaluation.examples.json`. Uruchomienie wymaga zmiennej `OPENROUTER_API_KEY` i jawnego wskazania wejścia oraz nowego pliku raportu:

```bash
node scripts/evaluate.mjs test/evaluation.examples.json raport-jev.json
```

Nie wpisuj klucza do repozytorium ani raportu. Skrypt wysyła wskazane wiadomości do OpenRouter; raport pomija ich treść. Mierzy triaż, ekstrakcję i kalkulator, bez kalendarza. Osiem przykładów startowych nie zastępuje reprezentatywnego zbioru i nie zostało użyte do deklarowania trafności.
