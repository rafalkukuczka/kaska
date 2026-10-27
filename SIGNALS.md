# Sygnały sprzedażowe

Operacje w tle są widoczne na pasku u dołu ekranu, również po zmianie zakładki. Konfiguracja źródeł i generowanie szkiców pokazują rzeczywisty licznik oraz procent; operacje bez znanej liczby kroków, np. pojedyncze zapytanie do AI, mają wskaźnik „W trakcie”. Pasek obejmuje także prace innych projektów, nie odświeża formularzy i znika po zakończeniu. Przycisk przerwania konfiguracji źródeł pozostaje dostępny na tym pasku.

## Symulacja Discover

W Discover dostępna jest symulacja: każde źródło przypisane do monitoringu wybranego projektu generuje dokładnie 3 przykładowe sygnały w przeglądarce. Dwa źródła oznaczają 6 zdarzeń na karcie monitoringu. Przycisk przy źródle pokazuje jego 3 sygnały, a „Zobacz zdarzenia” — symulowane wyniki całego monitoringu. Przykładowe firmy i zdarzenia mają oznaczenie „Symulacja”.

Symulacja jest domyślnie włączona przy pierwszym użyciu; przełącznik zapisuje wybór w przeglądarce. „Wyłącz symulację” przywraca rzeczywiste dane. Symulowane sygnały nie są zapisywane w SQLite ani wysyłane do OpenAI, nie mają przycisków akceptacji i nie mogą uruchamiać kampanii. „Symuluj skanowanie” nie pobiera danych z dostawców. Normalny serwerowy monitoring nadal działa niezależnie w tle.

## Dwa sposoby rozpoczęcia monitoringu

Pod logo Kaśka znajduje się wybór aktywnego **Projektu** i przycisk **+ Nowy projekt**. Każdy projekt ma własną nazwę, stronę, ofertę, odbiorców, pain points, value propositions i proof points. Nazwę można zmienić w sekcji „Projekt” w Discover. Dotychczasowe dane są zachowane w „Projektu 1”; nowe project mają puste pola. Wybór aktywnego projektu pozostaje po ponownym uruchomieniu.

Przycisk **Usuń projekt** pod wyborem projektu otwiera potwierdzenie. Projekt znika z wyboru, a jego monitoringi są wyłączane; wspólne źródła pracujące dla innych projektów pozostają aktywne. Kontakty i istniejące kampanie są zachowywane. Usunięcie aktywnego projektu przełącza na kolejny dostępny; usunięcie ostatniego tworzy nowy pusty projekt. Historia jest archiwizowana w bazie i nie jest przywracana przy restarcie. Usunięty projekt odrzuca spóźnione zapisy oraz wyniki AI. Przed usunięciem trzeba zakończyć trwające wyszukiwanie klientów lub tworzenie szkiców w tym projekcie.

Przełączenie najpierw zapisuje oczekujące zmiany. Szkice lokalne są oddzielne dla każdego projektu. Monitoring, oceny firm w Discover oraz historia wyszukiwań klientów są przypisane do projektu, również gdy wynik AI wróci już po przełączeniu. Ten sam sygnał może mieć różne oceny dla różnych ofert. Publiczne źródła mogą być współdzielone; okno usunięcia informuje o współdzieleniu między monitoringami.

Widok **Discover**, nad „Znajdź klientów” w nawigacji, pokazuje firmy warte uwagi, ich powiązanie z ofertą i cytaty ze zdarzeń. Monitoring rynku jest teraz częścią tego ekranu. Przycisk oceny analizuje maksymalnie 10 nowych zdarzeń przez OpenAI; można zatrzymać kolejne analizy po bieżącym zapytaniu. Pusta lista firm nie jest uzupełniana wymyślonymi wynikami.

Oferta, strona, odbiorcy, pain points, value propositions i proof points tworzą jeden **wspólny projekt** dla Discover i Znajdź klientów. Edycje oraz zastosowane propozycje AI zapisują się automatycznie do SQLite; lokalny szkic chroni zmiany oczekujące na zapis. Projekt można edytować w obu ekranach. Przy pierwszej migracji przenosimy ostatnie wyszukiwanie klientów, a gdy go nie ma — ostatni projekt z Biblioteki. Zapisany projekt nie jest ponownie nadpisywany przez migrację. Zmiana projektu oznacza starsze oceny firm jako wymagające ponownej oceny; nie wykonuje płatnych zapytań automatycznie.

Discover pozwala wybrać:

- **Na podstawie oferty** — wykorzystuje wspólną ofertę, odbiorców, problemy i propozycje wartości. Jedno zapytanie OpenAI proponuje do pięciu tematów, typy sygnałów oraz uzasadnienia. Plan nie jest faktem o rynku: wybierz interesujące tematy i uruchom je osobnym przyciskiem. Dopiero wtedy powstają źródła Google News i GDELT. Nie potrzebujesz firm w Kontaktach.
- **Monitoring tematu** — wpisz własną frazę i opcjonalnie typy sygnałów. Źródła powstają bez AI, oferty i firmy. Pusta lista typów oznacza wszystkie zdarzenia pasujące do tematu.

Każdy zapisany monitoring ma listę tematów i przycisk **Zobacz zdarzenia**, filtrujący zdarzenia po jego źródłach i wybranych typach. Te same tematy mogą współdzielić źródła: wykrywane typy są sumą potrzeb monitoringów (pusty filtr oznacza wszystkie). Zachowywane są istniejące ustawienia wstrzymania i akceptacji. Nowe źródła wymagają ręcznej akceptacji. Skanowanie odbywa się w tle; można też użyć „Skanuj źródła”. Błędy i ograniczenia dostawców są widoczne przy źródłach.

W zdarzeniu rynkowym przycisk **Wskaż firmy z AI** odczytuje firmy wyraźnie wymienione w tytule lub dowodzie. Każda zapisana firma wymaga dosłownego cytatu zawierającego jej nazwę. Nie dopisujemy firm na podstawie samej branży, nie wyszukujemy automatycznie adresów osób i nie tworzymy kontaktów ani kampanii. Uzasadnienie związku z ofertą jest hipotezą do sprawdzenia. Pusta lista oznacza brak firm w dostępnym dowodzie; nagłówki Google/GDELT nie zawsze zawierają wszystkie informacje z artykułu.

Dotychczasowe monitorowanie konkretnych firm oraz konfiguracja źródeł z Kontaktów są nadal w zakładce **Źródła**.

Źródła i wpisy ręczne mają dwa zakresy: **Firma** oraz **Rynek / temat**. Drugi zakres nie wymaga kontaktów ani nazwy firmy. W **Sygnały → Źródła → Dodaj źródło** wybierz „Rynek / temat”, wpisz np. `NIS2`, a następnie wybierz Google News, GDELT lub własny RSS/HTML/JSON. Wiadomości są filtrowane po dokładnej frazie tematu. HTML zapisuje pierwsze pobranie jako punkt odniesienia i wykrywa dopiero późniejsze zmiany.

Filtr „Rynkowe” w zdarzeniach pokazuje wpisy bez przypisanej firmy. Katalog obejmuje 50 dotychczasowych typów oraz zmianę przepisów, trend rynkowy i ogólną wiadomość dotyczącą tematu (53 typy). Gdy wpis rynkowy pasuje do tematu, ale nie do innych reguł, otrzymuje typ ogólnej wiadomości. To kontekst rynkowy do oceny; nawet zaakceptowany sygnał rynkowy nie dołącza automatycznie kontaktów do kampanii. Oferta nie jest wymagana. Konfigurator AI nadal wyszukuje źródła dla wybranych firm.

Gotowe adaptery Google News RSS, GDELT, Greenhouse i Lever opisuje [DATA-SOURCES.md](DATA-SOURCES.md). Są dostępne w **Sygnały → Źródła**. Daty publikacji i indeksacji zapisywane są osobno; dla nowych adapterów zastępują czas wykrycia w regułach wieku, kiedy data samego zdarzenia jest nieznana. Starszy opis poniżej dotyczy również własnych źródeł RSS/HTML/JSON.

Moduł jest dostępny w zakładce **Sygnały**. Zapisuje rzeczywiste dane z podłączonych źródeł albo udokumentowane wpisy ręczne. Nie zawiera przykładowych zdarzeń w bazie użytkownika.

## Co jest zaimplementowane

- 50 typów sygnałów z regułami słów kluczowych po polsku i angielsku. Pełny katalog, frazy i wagi są widoczne w panelu. Kategorie obejmują kapitał, zespół, ekspansję, produkt, technologię, intencję i aktywność.
- Odczyt RSS i Atom, monitorowanie zmian w publicznym HTML oraz odczyt JSON z udokumentowanym formatem.
- Harmonogram źródeł, ręczne wymuszanie skanu, historia ostatniego sukcesu i diagnostyka błędów dla każdego źródła.
- Zapis dowodu, adresu źródła, firmy, typu, daty zdarzenia (jeśli podana) oraz czasu wykrycia.
- Deduplikacja między skanami i źródłami na podstawie firmy, typu, adresu i tytułu.
- Priorytet 0–100: waga typu + świeżość + dopasowanie do aktywnych kontaktów. Panel pokazuje składniki oceny. Priorytet nie jest prawdopodobieństwem prawdziwości ani gotowości zakupu.
- Akceptowanie i odrzucanie zdarzeń. Opcjonalna automatyczna akceptacja na poziomie źródła.
- Reguły łączące zaakceptowane sygnały z kampaniami: typy, minimalny priorytet i maksymalny wiek.
- Jednorazowe dołączenie aktywnego kontaktu do danej kampanii, kontekst sygnału w personalizacji, respektowanie odpowiedzi i rezygnacji.

**50 typów detekcji nie oznacza 50 zintegrowanych baz dostawców.** Dostęp do płatnych baz, LinkedIn, prywatnego CRM czy danych analitycznych wymaga własnych źródeł lub dalszych konektorów. Typy takie jak zamówienie demo i wizyta na cenniku działają, gdy otrzymają dane z Twojego CRM lub analityki przez JSON albo wpis ręczny. Aplikacja nie identyfikuje anonimowych odwiedzających.

## Pierwsza kampania oparta na sygnałach

1. Dodaj kontakty z poprawnym polem **Firma**.
2. Utwórz nowy szkic kampanii, ale nie przygotowuj jeszcze wiadomości dla wszystkich kontaktów.
3. W szablonie możesz użyć `{{signal_title}}`, `{{signal_evidence}}`, `{{signal_url}}`, `{{signal_type}}`, obok istniejących `{{name}}`, `{{company}}` i `{{offer}}`.
4. Wejdź w **Sygnały → Reguły kampanii → Nowa reguła**, wybierz kampanię, typy, próg i wiek.
5. Dodaj źródło lub sygnał z dowodem. Zeskanuj źródło, sprawdź wynik i zaakceptuj właściwe zdarzenie.
6. Reguła doda wiadomości wyłącznie dla aktywnych kontaktów o tej samej nazwie firmy. Szkic pozwala sprawdzić wiadomości bez wysyłania.
7. Uruchom kampanię po podłączeniu poczty. Od tej chwili również nowe dopasowania do włączonej reguły będą automatycznie dołączane do kolejki. Obowiązują dotychczasowe limity i zatrzymanie po odpowiedzi/rezygnacji.

Nazwy firm są porównywane po usunięciu zewnętrznych spacji, z pominięciem wielkości liter i znaków diakrytycznych. `Acme Holdings` nie jest tym samym co `Acme`. System nie przypisuje firmy na podstawie podobnego adresu email ani nie tworzy nowych kontaktów ze zdarzeń.

Regułę można dodać wyłącznie do kampanii bez wiadomości; chroni to przed mieszaniem wcześniej przygotowanej listy wszystkich odbiorców z doborem na podstawie sygnałów. Kampanie z regułą nie wracają do wszystkich kontaktów po kliknięciu „Przygotuj wiadomości”. Kampania wstrzymana nie przyjmuje nowych odbiorców; dopasowania będą ponownie rozpatrzone po jej wznowieniu i następnym skanie.

Każdy kontakt dołącza do kampanii tylko raz, nawet jeśli pojawi się następny sygnał. Odrzucenie lub cofnięcie akceptacji sygnału anuluje oczekujące wiadomości dołączone z jego powodu. Ponowna akceptacja nie odtwarza anulowanej sekwencji; do ponownego kontaktu potrzebna jest nowa kampania. Wysłanych wiadomości nie da się cofnąć.

Zmiany i wyłączenie reguły dotyczą przyszłych dołączeń. Aby zatrzymać wcześniej przygotowaną kolejkę, wstrzymaj kampanię. Wyłączenie źródła zatrzymuje pobieranie, ale zachowuje istniejące sygnały i ich statusy.

## Źródła RSS / Atom

Podaj publiczny adres HTTPS kanału oraz nazwę monitorowanej firmy. Ogólne kanały informacyjne są filtrowane: nazwa firmy musi wystąpić w tytule lub treści jako pełna fraza. Nie są obsługiwane aliasy firm ani wnioskowanie o podmiocie artykułu. Wzmianka nie dowodzi, że zdarzenie dotyczy firmy — domyślnie wymagana jest ręczna akceptacja.

Skan przetwarza maksymalnie 200 wpisów. Zdarzenia starsze niż 90 dni są pomijane. Daty publikacji są zachowywane z uwzględnieniem strefy czasowej. Jeśli źródło nie ma daty, panel wyraźnie podaje „data nieznana”, a reguła liczy wiek od wykrycia. Wpisy z nieprawidłowymi datami zgłaszają błąd źródła.

## Strony HTML

Podaj stronę aktualności, kariery albo inny publiczny adres dotyczący danej firmy. Pierwszy skan zapisuje bazowy tekst i nie tworzy sygnałów. Następne skany analizują wyłącznie nowe fragmenty tekstu mające co najmniej 30 znaków. Przestawienie istniejących fragmentów nie jest nowym sygnałem. Skrypty i style są pomijane.

Nie jest uruchamiany JavaScript strony. Strony renderowane wyłącznie przez skrypty, logowanie, blokady antybotowe, usunięcia i zmiany bez rozpoznawalnych fraz mogą nie dać sygnału. Zmiana tekstu jest wskazówką do sprawdzenia, nie potwierdzeniem nowego zdarzenia.

## JSON — format dla CRM i analityki

Źródło pobiera publiczny endpoint HTTPS zwracający tablicę lub obiekt z tablicą `items`:

```json
{
  "items": [
    {
      "company": "Acme",
      "kind": "demo_request",
      "title": "Prośba o prezentację produktu",
      "evidence": "Zdarzenie formularza #123 z systemu CRM",
      "url": "https://crm.example.com/events/123",
      "occurred": "2026-10-26T10:00:00Z"
    }
  ]
}
```

`kind` jest kluczem z katalogu (np. `funding`, `hiring`, `new_ceo`, `crm`, `tender`, `pricing_visit`). Bez niego wykonywana jest detekcja fraz w tytule i dowodzie. `occurred` jest opcjonalne; można podać ISO 8601 albo sekundy Unix. Jeśli podasz `company`, musi odpowiadać firmie skonfigurowanej dla źródła. Bez tego pola wymagana jest wzmianka o firmie w treści. Nieznany jawnie podany typ powoduje błąd.

Ta wersja nie ma logowania do źródeł JSON ani automatycznego eksportu CRM. Endpoint powinien udostępniać wyłącznie dane przeznaczone do takiego odczytu; nie umieszczaj w publicznym pliku danych osobowych ani sekretów. Prywatny CRM można obsłużyć wpisem ręcznym albo przez lokalne API aplikacji w osobnej integracji. Przykładowy plik: `examples/signals.json` (nie jest automatycznie importowany).

## Harmonogram i ograniczenia

- Sprawdzenie terminów skanowania następuje co minutę w oddzielnym wątku. Każde źródło ma interwał 5–10080 minut. Przycisk „Skanuj źródła” wymusza odczyt niezależnie od interwału. Serwer musi być uruchomiony.
- Jednocześnie działa jeden skan. Źródła są pobierane kolejno, z timeoutem 15 sekund na operację sieciową i maksymalnie trzema przekierowaniami.
- Dozwolone są HTTPS i publiczne adresy sieciowe; prywatne adresy, dane logowania w URL i inne porty są blokowane. Połączenie używa zweryfikowanego IP i sprawdza certyfikat TLS. Limit odpowiedzi wynosi 1 MB.
- Błędny rekord cofa nowe sygnały z danego odczytu źródła. Inne źródła mogą być przetwarzane dalej. Błąd jest zapisywany przy źródle.
- Skuteczność fraz zależy od języka, sposobu pisania i jakości źródła. Negacje, cytaty, archiwalne opisy i wzmianki o innych firmach mogą generować fałszywe trafienia. Domyślnie nie są one akceptowane automatycznie.
- Stan panelu zawiera do 2000 ostatnich sygnałów i dołączeń. Wszystkie rekordy pozostają w SQLite.

## API lokalne

Fikcyjne kontakty można zaznaczyć i dodać do listy po potwierdzeniu operacji. Są przechowywane lokalnie w `sessionStorage`, osobno dla każdego projektu, i nakładane na widok Kontaktów tylko w symulacji. Mają etykietę „Symulacja”; zmianę ich listy i statusu również zapisujemy lokalnie. Wyłączenie symulacji ukrywa je, a ponowne włączenie przywraca w tej samej sesji przeglądarki. Nie są zapisywane w SQLite i nie trafiają do rzeczywistych kampanii ani wysyłki. Kontakty wpisane ręcznie nadal zapisują się normalnie.

Osobny przycisk **Zapisz wybrane w bazie** zapisuje zaznaczone fikcyjne osoby trwale w SQLite. Wymaga potwierdzenia i nazwy listy kontaktów. Rekordy mają `simulated=1` i pozostają widoczne po wyłączeniu symulacji oraz po ponownym uruchomieniu aplikacji. Można zmieniać ich listę i status tak jak innych kontaktów. Duplikaty nie tworzą nowych osób; dla istniejącego rekordu symulacyjnego można zmienić listę bez zmiany statusu. Istniejący zwykły kontakt nie jest przeklasyfikowywany na symulacyjny. Tych rekordów nie uwzględnia przygotowanie rzeczywistych kampanii, automatyczne dołączanie z sygnałów, wyszukiwanie źródeł firm ani kolejka SMTP. Endpoint `POST /api/discover/contacts/add-simulation` przyjmuje `project_id`, `company`, `contacts` (1–10 wybranych osób z `name`, `email`, `role`), `target_group` i `confirm_company=true`; wymaga aktywnej symulacji oraz adresów w fikcyjnej domenie `.example`.

Panel „Znajdź kontakt” w trybie symulacji pokazuje przykładowe osoby po rozwinięciu (1–10, zgodnie z wybranym limitem). Dane są jawnie fikcyjne, używają domeny `.example`, nie wywołują Hunter i zachowują oznaczenie symulacji również po opcjonalnym zapisie w bazie. W Discover usunięto nagłówek „Jak chcesz szukać okazji?” i zbiorczy przycisk „Oceń firmy”; przyciski tworzenia monitoringów oraz wskazywanie firm z pojedynczych zdarzeń pozostają dostępne.

W Discover każda karta w „Firmy warte uwagi” zawiera zwinięty panel „Znajdź kontakt”. Wyszukiwanie korzysta z klucza Hunter z Integracji i może zużywać kredyty. Wystarczy nazwa firmy z monitoringu; opcjonalnie można wskazać domenę, stanowiska i liczbę osób (1–10). Wyniki zawierają znalezioną domenę, adresy osobiste oraz publiczne źródła. Przed zapisem należy potwierdzić dopasowanie firmy, zaznaczyć osoby i wybrać lub wpisać grupę docelową. Zapis nie uruchamia kampanii ani nie weryfikuje dostarczalności adresu. Istniejące kontakty mogą zmienić grupę bez zmiany statusu, również gdy wypisały się z korespondencji. Wyniki do importu są przypisane do projektu i wygasają po 24 godzinach. Symulacja zwraca fikcyjne kontakty bez wywołania Hunter i bez możliwości zapisania ich w rzeczywistej bazie.

Wyszukiwanie i zapis obsługują `POST /api/discover/contacts/search` (`project_id`, `company`, opcjonalne `domain`, `titles`, `limit`) oraz `POST /api/discover/contacts/add` (`project_id`, `id` wyszukiwania, `selected` — indeksy wyników, `target_group`, `confirm_company: true`).

Stan i katalog znajdują się w `GET /api/state` pod kluczem `signals`. Mutacje wymagają aktualnego `X-CSRF-Token` z tej samej instancji. Nie wystawiaj API publicznie.

| Metoda | Ścieżka | Dane |
|---|---|---|
| POST | `/api/signals/sources` | `name`, `kind` (`rss/page/json`), `url`, `company`, `interval_minutes`, `auto_accept` |
| POST | `/api/signals/source/status` | `id`, `enabled` |
| POST | `/api/signals/scan` | opcjonalne `id` źródła |
| POST | `/api/signals/record` | `company`, `kind`, `title`, `evidence`, `url`, opcjonalne `occurred` |
| POST | `/api/signals/status` | `id`, `status` (`new/accepted/dismissed`) |
| POST | `/api/signals/rules` | `campaign_id`, `kinds` (tablica), `min_score`, `max_age_days`, `enabled` |
| POST | `/api/signals/apply` | pusty obiekt |

Przechowywanie: tabele `signal_sources`, `sales_signals`, `signal_rules`, `signal_enrollments` w istniejącej bazie. Start aplikacji dodaje brakujące tabele i indeksy bez kasowania kontaktów i kampanii.

Mapę obszarów można otworzyć podczas tworzenia monitoringu tematu, przygotowania planu z oferty i zatwierdzania planu AI. Wstępnie kopiowane są obszary aktywnego projektu; zmiany i anulowanie w oknie monitoringu nie zmieniają projektu. Każdy monitoring zapisuje własne `search_areas` (do 10 środków z promieniem 1–1000 km) i pokazuje ich podsumowanie na karcie. Plan AI otrzymuje wybrany zasięg jako kontekst. Wspólne kanały Google News/GDELT pozostają oparte na tematach: mapa określa oczekiwany zasięg, lecz dokładne położenie zdarzeń wymaga sprawdzenia; nie deklarujemy nieobsługiwanego przez kanały filtrowania po promieniu. Obszary można zmienić przed aktywacją planu.

Symulacja pobierania danych: checkbox pod logo dotyczy odczytów zewnętrznych (wyszukiwanie i weryfikacja kontaktów, skanowanie źródeł, odczyt stron, materiałów i poczty). Project, oferty, punkty wartości, ręczne kontakty, kampanie, tematy oraz konfiguracja źródeł są wspólne dla obu trybów i zapisywane normalnie. Przełączenie nie podmienia treści formularzy. Przykładowe wyniki pobierania są oznaczone, przechowywane osobno w sessionStorage według projektu i nie trafiają do rzeczywistych kampanii; symulacja weryfikacji nie oznacza adresu jako potwierdzonego. Każde aktywne źródło monitoringu zwraca trzy przykłady. Brak domyślnych firm i monitoringów. Tryb jest zapisany w app_preferences i respektowany przez skaner źródeł w tle. Generowanie tekstów przez AI i edycja integracji nie są symulowane. Symulacja obejmuje także wysyłkę i odpowiedzi: przycisk „Symuluj wysyłkę” pokazuje oczekiwanie, wysyłanie i zakończenie. Część osób odpowiada fikcyjnie; odpowiedzi widać w zakładce Odpowiedzi, a dalsze kroki tych osób zostają zatrzymane w symulacji. Stan demonstracyjny pozostaje w sessionStorage według projektu, bez zmiany rzeczywistych wiadomości i odpowiedzi. Serwer blokuje rzeczywistą wysyłkę SMTP, gdy symulacja jest włączona. Wyłączenie trybu ukrywa fikcyjne odpowiedzi i wstrzymuje lokalny przebieg symulacji.
