# Weryfikacja JevCSAssistant — 22.09.2026

Wynik: 139 testów zaliczonych, 0 błędów. Node.js v20.19.6.

| Zestaw | Zaliczone | Zakres |
| --- | ---: | --- |
| test/jev-pipeline.test.mjs | 31 | API na atrapach, walidacja odpowiedzi, ekstrakcja, cennik, opłaty, nieprawidłowe ilości, wzorce, reguły dostępności |
| test/content.test.mjs | 9 | Identyfikacja wątku i wiadomości, niepełny odczyt, ochrona istniejącego draftu i zmienionego wątku |
| test/logic.test.mjs | 52 | Parser kalendarza i obliczenia dostępności |
| test/background.test.mjs | 47 | Transport, cykle semi-auto, deduplikacja, kolejka zapisu, pomijanie powtórnej analizy, własna karta kalendarza |

Zestawy uruchomiono bezpośrednio poleceniem `node test/<nazwa>.test.mjs`. Testy background trwają około 104 sekund z powodu sprawdzania timeoutów. W teście ochrony draftu naprawiono niekompletną atrapę DOM i ponownie uruchomiono cały zestaw content.

Dodatkowo:

- Sprawdzono składnię wszystkich 23 plików JS/MJS przez `node --check`.
- Sprawdzono istnienie zasobów wskazanych w manifeście.
- Porównano SHA256 11 plików głównej instalacji z BASELINE.json: wszystkie niezmienione.
- Przeglądarkowy podgląd panelu i ustawień korzysta z atrap Chrome/API; nie jest testem zainstalowanego rozszerzenia.

Nie wykonano testu rzeczywistego API Jev, sesji Google ani zapisu w Gmailu. Nie zmierzono trafności ekstrakcji ani przyspieszenia względem poprzedniego LLM. Dostępność wymaga wybrania dwóch reguł biznesowych opisanych w STATUS-MIGRACJI.md; brak czasu wizyty wymaga ręcznego uzupełnienia.
