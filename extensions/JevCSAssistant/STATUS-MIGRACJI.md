# Status migracji

Wdrożono osobną kopię `versions/JevCSAssistant`, triaż i ekstrakcję Jev, katalog użytkownika, kalkulator, adapter kalendarza, wzorce PL/EN, panel korekty, wspólny zapis draftów, semi-auto/tryb porównawczy, metryki, dokumentację i testy.

Weryfikacja lokalna: **139/139 testów**, składnia 23 plików JS/MJS i zasoby manifestu poprawne. Szczegóły: `TESTY.md`.

## Rozstrzygnięcia biznesowe oczekujące na odpowiedź

1. Znaczenie liczb w kalendarzu: cała obsada minus rezerwacje czy już wolni instruktorzy (prototyp)?
2. Propozycje dla godzinnej wizyty: 12:30 → 14:00 (dostarczony plik) czy również 13:00 jako alternatywa (prototyp)?

Obie reguły można wybrać w ustawieniach. Do rozstrzygnięcia mają stan „Wybierz regułę”; adapter kalendarza nie podaje godzin na podstawie domysłu. Wycena działa niezależnie. Kod obsługuje obydwa modele.

## Pozostałe ograniczenia

- Przekazane pliki nie określają czasu wizyty na podstawie rodzaju pakietu lub strzałów. Nowy automat nie stosuje starego domyślnego 30 min; ręczny panel pozwala uzupełnić czas.
- Cennik został przeniesiony; nie wykonano niezależnego audytu wszystkich cen przez operatora.
- Brak testu prawdziwego API i sesji Google w tej sesji; dostępny jest jedynie przeglądarkowy podgląd z atrapami.
- Brak pomiarów p50/p95 i zestawu 100–200 oznaczonych rzeczywistych maili, więc etap oceny produkcyjnej z planu jest nadal przed nami.
- LLM tylko opcjonalnie dodaje powitanie/zakończenie. Złożone sprawy wymagają człowieka zamiast automatycznej swobodnej redakcji.
- Pełna nawigacja kalendarza z prototypu nie została włączona do nowego głównego procesu; dostępność z dotychczasowego adaptera jest oznaczona jako wstępna.

Nie zmodyfikowano kodu głównej instalacji ani istniejącego prototypu.
