# Centralna konfiguracja CSA — etap 1

Aplikacja: https://chat-csa.vercel.app. Rozszerzenie: `extensions/JevCSAssistant` (0.2.0).

## Zakres

Supabase przechowuje wyłącznie kolejne publikacje konfiguracji: katalog i ceny, wzorce odpowiedzi PL/EN, reguły dostępności oraz bibliotekę ręcznych wzorców maili. Gmail i Google Calendar pozostają źródłami korespondencji i rezerwacji. Nie dodano Google OAuth, Calendar API, bazy spraw ani nowej automatyzacji wysyłania wiadomości.

Pierwszy etap ma ręczne publikowanie przez polecenie administracyjne i ręczne pobieranie we wtyczce. Nie ma jeszcze panelu edycji w aplikacji ani synchronizacji w tle. Webowy chat zachowuje dotychczasową konfigurację promptu — nie przekazujemy mu automatycznie centralnej biblioteki ani nie wysyłamy jej w całości do AI. Dotychczasowy przepływ Jev we wtyczce nadal używa wybranego katalogu do analizy, zgodnie z istniejącą integracją OpenRouter.

## Uruchomienie

1. W projekcie Supabase aplikacji wykonaj `supabase/migrations/20260924_shared_configuration.sql` (SQL Editor lub dotychczasowy proces migracji). Tabela ma RLS i nie daje dostępu klientom `anon`/`authenticated`. Serwer używa istniejącego `SUPABASE_SERVICE_ROLE_KEY`.
2. Wygeneruj osobny losowy token, np. `openssl rand -hex 32`. Wstaw go do zmiennej środowiskowej **CONFIG_READ_TOKEN** w Vercel. Nie używaj klucza Supabase jako tokenu. Nie zapisuj tokenu w repo, adresie URL ani wiadomości. Istniejące `NEXT_PUBLIC_SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` muszą pozostać skonfigurowane.
3. Wdróż zmianę aplikacji. Endpoint `GET /api/configuration` wymaga `Authorization: Bearer <token>`. Brak tokenu serwera daje 503, błędny token żądania 401, brak publikacji 404. Błędy bazy nie ujawniają szczegółów klientowi. Żaden endpoint zapisu nie jest publicznie dodawany.
4. Przygotuj plik `configuration.json`: najlepiej z przycisku „Eksportuj konfigurację do publikacji” w nowej wtyczce. Eksportuje zapisane ustawienia, więc najpierw zapisz formularz. Sprawdź treści wzorców: allowlista usuwa pola sekretów, ale nie rozpoznaje sekretu ręcznie wklejonego w treść. Alternatywnie skopiuj `configuration.example.json` i uzupełnij dane. Przykład ma `approved=false` i niepotwierdzone reguły — wymaga sprawdzenia przez operatora.
5. W lokalnym `.env.local` ustaw dane Supabase (plik jest ignorowany przez Git), następnie:

```sh
npm ci
node scripts/publish-configuration.mjs configuration.json --check
node --env-file=.env.local scripts/publish-configuration.mjs configuration.json
```

Pierwsza publikacja musi mieć `revision: 1`. Każda kolejna ma poprzednią wartość + 1. Data publikacji jest ustawiana przez polecenie. Jednoczesne próby publikacji tej samej wersji rozstrzyga klucz główny w bazie. Nie modyfikujemy opublikowanych dokumentów. Wycofanie błędnej zmiany to nowa, wyższa wersja z przywróconą treścią.

6. W Chrome wczytaj rozpakowane rozszerzenie z `extensions/JevCSAssistant`. Jeśli przełączasz się z poprzedniej instalacji, najpierw wyłącz w niej semi-auto; nie uruchamiaj dwóch automatów. Inna ścieżka rozszerzenia może oznaczać nowy magazyn ustawień — lokalne wzorce i sekrety nie przeniosą się same. Możesz zamiast tego zaktualizować pliki w dotychczasowym katalogu instalacji, zachowując ścieżkę i przeładować rozszerzenie.
7. Ustawienia → Konfiguracja centralna → adres `https://chat-csa.vercel.app/api/configuration`, token odczytu → „Pobierz i zastosuj konfigurację”. Chrome poprosi wyłącznie o dostęp do tej domeny. Token jest użyty do jednego pobrania, nie jest zapisywany w storage i po sukcesie znika z formularza.

## Zachowanie

- Cennik, reguły i wzorce centralne zastępują lokalne na czas pracy w trybie centralnym. Lokalne dane pozostają nienaruszone, a przycisk powrotu do lokalnej konfiguracji je przywraca.
- Edycja centralnych wzorców i ustawień we wtyczce jest zablokowana. Zmiany wymagają nowej publikacji. Wzorce HTML przechodzą istniejące oczyszczanie przed użyciem.
- Nie pobieramy konfiguracji automatycznie. Operator widzi numer wersji, datę publikacji i ostatniego pobrania. Offline działa ostatnia poprawna kopia, bez automatycznego terminu ważności; operator powinien pobrać aktualizację przed pracą.
- Niepoprawna odpowiedź, błąd autoryzacji, timeout 15 sekund, przekierowanie, ponad 512 kB lub starsza wersja nie zastępują dobrej kopii.
- Zmiana centralnej wersji blokuje zapis draftu przygotowanego ze starszej konfiguracji. Należy go ponownie przeliczyć. Nie zmienia to już wysłanych ofert.
- Sekrety Google/OpenRouter, ustawienia uruchamiania semi-auto i cache kalendarza nie są wysyłane do endpointu konfiguracji. Pobieranie to GET bez treści żądania, bez cookies.
- Wersja 1 centralizuje reguły `availabilityPolicy`. Stałe algorytmu kalendarza z `logic.js` nadal należą do kodu rozszerzenia; nie są zdalnie wykonywanym kodem.

## Sprawdzenie

```sh
npm run test:central
npm run test:extension
npx tsc --noEmit
npm run build
```

Pełna kompilacja istniejącej aplikacji wymaga konfiguracji Supabase (strona `/admin/settings` odczytuje ją podczas budowania). Testy Node używają atrap; nie dowodzą działania produkcyjnego Supabase, uprawnień Chrome ani Gmaila. Przed użyciem produkcyjnym: opublikuj testową wersję, sprawdź pobranie w Chrome, odłącz sieć, sprawdź powrót do lokalnych ustawień i zablokowanie starego draftu po nowej publikacji.

## Weryfikacja wykonana przy wdrożeniu kodu (24.09.2026)

- 6 testów kontraktu i pobierania konfiguracji: OK.
- 140 dotychczasowych testów rozszerzenia: OK.
- Dodatkowy test odmowy zapisu draftu po zmianie centralnej wersji: OK (z inicjalizacją środowiska).
- TypeScript, ESLint nowych plików serwera/testów, składnia zmienionych skryptów rozszerzenia: OK.
- Kompilacja produkcyjna Next.js: OK z lokalną atrapą Supabase; brak połączenia z produkcyjną bazą.
- Skompilowany endpoint na localhost: 401 bez tokenu i z błędnym tokenem; 200 z poprawnym tokenem i Cache-Control no-store; POST 405.
- Nie przeprowadzono instalacji tej wersji w rzeczywistym Chrome ani migracji produkcyjnego Supabase.
