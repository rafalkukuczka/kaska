# Gotowe integracje danych

## Automatyczna konfiguracja z AI

W **Sygnały → Źródła → Skonfiguruj źródła z AI** wybierz do 50 firm z Kontaktów. Opcjonalnie podaj ofertę (lub wybierz ją z Biblioteki) i opis odbiorców. AI wyszukuje oficjalną stronę, stronę kariery, RSS/Atom oraz tablice Greenhouse i Lever. Nie odkrywa prywatnych integracji CRM/JSON. Korzysta ze skonfigurowanego w Integracjach modelu OpenAI, który musi obsługiwać `web_search` i wynik JSON. Wyszukiwanie może generować dodatkowe opłaty API. Dokumentacja integracji: [OpenAI Docs — Web search](https://developers.openai.com/api/docs/guides/tools-web-search).

Zadanie działa w tle i pokazuje postęp. **Przerwij konfigurację** jest dostępne na stałym pasku w dowolnej zakładce oraz w nagłówku konfiguracji źródeł, także podczas oglądania starszego raportu. Zatrzymanie czeka na bieżące zapytanie; późniejsze firmy nie są przetwarzane, a ukończone firmy i ich źródła pozostają zapisane. Pasek pokazuje stan przerywania i znika po zatrzymaniu. Błąd bieżącego odczytu nie zmienia przerwanego zadania w błąd. Odświeżanie postępu nie przeładowuje formularzy w innych zakładkach. Przed uruchomieniem formularz można zamknąć przyciskiem **Anuluj**.

Lista **Historia konfiguracji** udostępnia pięć ostatnich raportów. Po restarcie zadanie ma status przerwanego i nie jest automatycznie ponawiane.

Samo wskazanie adresu przez AI nie wystarcza do aktywowania monitoringu. Strona firmy musi wystąpić w wynikach wyszukiwania, dać się odczytać, zawierać nazwę firmy oraz odpowiadać domenie firmowej kontaktu. Domeny popularnych skrzynek prywatnych nie służą jako potwierdzenie tożsamości. Kanał lub tablica pracy muszą być podlinkowane na potwierdzonej stronie firmy albo jej stronie kariery; dodatkowo odczytujemy RSS/Atom lub API tablicy. Google News i GDELT przechodzą odczyt testowy niezależnie od dostępności strony firmy. Zapytania wiadomości opierają się na podanej nazwie; zgodność nazwy nie potwierdza tożsamości firmy opisanej w każdym wyniku. Zdarzenia wymagają przeglądu. Brak wyników wiadomości/ofert pracy nie jest błędem połączenia.

Zweryfikowane źródła zapisują się automatycznie. Niepewne lub niedostępne adresy pozostają w raporcie **Do sprawdzenia**, z uzasadnieniem i klikalnymi dowodami z wyszukiwania. Raport pokazuje też dobrane typy sygnałów. Nowe źródła wymagają ręcznej akceptacji zdarzeń; AI nie uruchamia kampanii. Istniejące źródła są ponownie wykorzystywane i otrzymują nowe filtry typów sygnałów, z zachowaniem wstrzymania i ustawień akceptacji. Źródła wcześniej usunięte nie są przywracane automatycznie.

Do OpenAI wysyłamy nazwy firm, wskazówki domenowe, ofertę, opis odbiorców i katalog typów sygnałów. Nie przekazujemy pełnych adresów email ani nazwisk kontaktów w tym procesie. Walidacja publicznych adresów korzysta z ochrony przed odczytem sieci prywatnej. Dowody ograniczają ryzyko pomylenia firm, ale nie zastępują przeglądu rzeczywistych zdarzeń.

Nieznalezione adresy mogą mieć wartość `null` albo pusty tekst; nie przerywa to konfiguracji. Puste `signal_kinds`, np. przy braku oferty, oznacza monitorowanie wszystkich obsługiwanych typów w nowych źródłach. W takim przypadku istniejące filtry typów pozostają zachowane. Niepoprawna treść odpowiedzi dotyczącej jednej firmy trafia do raportu **Do sprawdzenia**, bez automatycznego ponawiania zapytania. Pozostałe firmy są przetwarzane dalej. Błędy klucza, limitu API lub połączenia zatrzymują zadanie, aby nie powtarzać nieskutecznych wywołań. Wymagane pola nadal podlegają walidacji; brak danych nie powoduje dodawania niezweryfikowanych źródeł.

## Konfiguracja ręczna i zbiorcza

W **Sygnały → Źródła → Źródła dla firm z Kontaktów** ustawisz monitoring zbiorczo. Formularz pobiera wszystkie unikalne, niepuste nazwy firm z bazy Kontaktów. Domyślnie zaznacza wszystkie firmy i rodzaje źródeł; możesz ograniczyć wybór. Google News i GDELT wymagają wyłącznie nazwy do wyszukania. W sekcji **Dodatkowe źródła dla tej firmy** wpiszesz identyfikatory lub adresy Greenhouse/Lever oraz adresy strony, RSS i JSON. Pełny adres Lever EU ustawia instancję europejską. Brakujące adresy są pomijane i raportowane, bez zgadywania domen ani tablic.

Zapis tworzy konfiguracje bez oczekiwania na dostawców; harmonogram pobiera dane w tle. Ponowne użycie pomija źródła o takim samym rodzaju, adresie i znormalizowanej nazwie firmy. Istniejące ustawienia, w tym wstrzymanie i automatyczna akceptacja, pozostają zachowane. Nowe źródła wymagają ręcznej akceptacji zdarzeń. Błąd konfiguracji wycofuje cały nowy pakiet.

Przy każdym źródle znajduje się **Usuń źródło**, z potwierdzeniem. Źródło znika z listy i przestaje być skanowane; spóźniony odczyt nie zapisze nowych wyników. Sygnały, dowody, kontakty i wiadomości pozostają zachowane. Usunięcie źródła nie odrzuca wcześniejszych sygnałów ani nie wstrzymuje kampanii.

W **Sygnały → Źródła** wybierz kartę integracji i podaj monitorowaną firmę. Przycisk **Podłącz i pobierz dane** zapisuje konfigurację oraz wykonuje pierwszy skan. Nie wymaga kluczy API i nie wysyła wiadomości. Nie wpisano domyślnych klientów ani firm do monitorowania.

| Integracja | Konfiguracja | Rzeczywiste dane |
|---|---|---|
| Google News RSS | nazwa firmy, opcjonalna nazwa używana w nagłówkach, 1–90 dni | wiadomości znalezione przez RSS Google News |
| GDELT DOC 2.0 | nazwa lub fraza, 1–90 dni | nagłówki z globalnego indeksu wiadomości i linki do wydawców |
| Greenhouse Job Board | identyfikator tablicy pracodawcy | publiczne stanowiska, lokalizacje, daty publikacji, linki do ofert |
| Lever Postings | identyfikator tablicy i instancja globalna/EU | publiczne stanowiska, fragment opisu, data utworzenia i link do oferty |

Wyniki są zapisywane w istniejącym module sygnałów. Informacje o pracach są klasyfikowane jako rekrutacja ogólna, IT, sprzedaż, marketing lub kadra kierownicza na podstawie nazwy stanowiska. Nie oznacza to, że osoba została już zatrudniona, ani że firma zwiększa zatrudnienie netto.

## Wiadomości o firmie

Google News i GDELT wyszukują wskazaną frazę i wymagają jej wystąpienia w nagłówku. Opcjonalna nazwa wyszukiwana pozwala powiązać skróconą nazwę medialną z pełną nazwą firmy z kontaktów. Nagłówki są analizowane dotychczasowymi regułami fraz. Wiadomość bez rozpoznanego typu nie staje się sygnałem tylko dlatego, że wspomina firmę. Samo wspomnienie, pytanie w tytule lub spekulacja nie potwierdza zdarzenia — domyślnie sygnały wymagają ręcznej akceptacji.

Google News jest integrowane przez publiczny RSS, bez gwarancji dostępności ani stabilnego kontraktu API. Linki do wiadomości prowadzą przez Google News. GDELT zwraca linki do wydawców; adapter pomija linki bez HTTPS. Nie pobieramy pełnej treści artykułów.

- Google News: do 200 wpisów zwróconych przez czytnik RSS (dostawca zwykle zwraca mniej).
- GDELT: do 100 artykułów na skan.
- Przy GDELT wymagany jest odstęp co najmniej 5 sekund między zapytaniami adaptera. HTTP 429 powoduje zapis błędu i odłożenie próby; nie jest traktowane jako pusty wynik.

## Tablice pracodawców

Identyfikator pochodzi z adresu strony kariery, np. `boards.greenhouse.io/identyfikator`, `job-boards.greenhouse.io/identyfikator`, `jobs.lever.co/identyfikator` lub `jobs.eu.lever.co/identyfikator`. Podaj tylko identyfikator, nie pełny adres. Użytkownik musi sprawdzić, czy tablica należy do monitorowanej firmy. System nie zgaduje identyfikatora z nazwy i nie potwierdza tożsamości właściciela tablicy.

Greenhouse jest odczytywane z publicznego endpointu `boards-api.greenhouse.io/v1/boards/{board}/jobs`. Adapter sortuje listę po dostępnej dacie pierwszej publikacji i przetwarza do 200 ofert. Jeżeli lista jest większa, panel pokazuje ograniczenie. Data `updated_at` jest opisywana jako aktualizacja źródła, nie jako nowa publikacja ani nowy nabór.

Lever jest odczytywane z `api.lever.co/v0/postings/{board}` lub `api.eu.lever.co/v0/postings/{board}`. Adapter pobiera do czterech stron po 25 ofert z ustalonych endpointów. Jeżeli wyników jest więcej, pokrycie jest ograniczone do odczytanych stron — panel pokazuje ostrzeżenie. Oferty istniejące od ponad 90 dni nie tworzą nowych sygnałów. Źródła nie udostępniają w tej integracji adresów email decydentów.

## Daty, błędy i automatyzacja

- Data publikacji artykułu lub oferty jest zapisywana osobno jako **Publikacja**. Czas `seendate` z GDELT jako **Indeksacja**. Nie są prezentowane jako potwierdzona data zdarzenia.
- Reguły wieku i świeżości używają kolejno: daty zdarzenia, daty źródłowej, czasu wykrycia. Dane starsze niż 90 dni są pomijane.
- Ponowne skany deduplikują wpisy. W źródle widoczne są: liczba pobranych wpisów, liczba wpisów pasujących do firmy, liczba nowych sygnałów, ostatni sukces i ostatni błąd. Zero nowych sygnałów może oznaczać duplikaty, brak pasujących fraz lub stare dane.
- Dostępne źródła są odczytywane według interwału, a po błędzie ponawiane po czasie oczekiwania. Minimum przerwy po HTTP 429 wynosi 5 minut, dłużej gdy dostawca poda `Retry-After`. Wymuszenie skanu nie omija okresu oczekiwania.
- Odpowiedzi adapterów mają limit 4 MB i krótki cache 60 sekund. Własne źródła RSS/HTML/JSON zachowują limit 1 MB. Dane pozostają w lokalnej bazie SQLite.
- Automatyczna akceptacja jest opcjonalna i domyślnie wyłączona. Zaakceptowane sygnały mogą uruchamiać skonfigurowane reguły kampanii. Nie są tworzone nowe kontakty ani zgadywane adresy email.

## API konfiguracji

`POST /api/signals/sources`, z tokenem CSRF:

```json
{
  "kind": "greenhouse",
  "company": "Nazwa firmy z bazy kontaktów",
  "config": {"board": "identyfikator-pracodawcy"},
  "interval_minutes": 360,
  "auto_accept": false
}
```

Typy: `google_news`, `gdelt`, `greenhouse`, `lever`. Dla wiadomości `config` zawiera `search_term` (opcjonalne) i `days`. Dla Lever: `board`, `region` (`global` / `eu`). Adres endpointu generowany jest przez adapter; nie podaje się go ręcznie. Ponowne dodanie tej samej firmy i endpointu zwraca istniejące źródło. Własne RSS, HTML i JSON nadal są dostępne.

## Weryfikacja

Testy jednostkowe i integracyjne: `python -m unittest discover -s tests -v`.

Opcjonalna próba na rzeczywistych API: `python tests/live_connectors.py`. Używa osobnej tymczasowej bazy, nie zmienia danych użytkownika ani nie wysyła poczty. Zapisuje raport do `test-results/live-connectors.json`. Firmy w tym skrypcie to wyłącznie cele technicznego testu publicznych endpointów, nie domyślni klienci aplikacji.

Próba 26 października 2026 potwierdziła odczyt Google News, Greenhouse i Lever oraz zapis sygnałów z rzeczywistymi linkami. GDELT odpowiedział HTTP 429; obsługa limitu i okresu oczekiwania została potwierdzona, ale udany odczyt danych GDELT nie został w tej próbie potwierdzony. Szczegółowe liczby zależą od aktualnych wyników i są w raporcie.

Dokumentacja dostawców: [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html), [Lever Postings API](https://github.com/lever/postings-api), [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/), [Google News](https://news.google.com/).
