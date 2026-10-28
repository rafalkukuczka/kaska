# Kaśka — lokalny system kampanii sprzedażowych

Aplikacja z polskim i angielskim interfejsem oraz wiadomościami w sześciu językach. Python 3.12+, bez dodatkowych bibliotek. Interfejs WWW, API, trwała baza SQLite i proces obsługujący kolejkę w jednej aplikacji. Jest to własna implementacja podstawowego procesu outbound, a nie kopia kodu lub infrastruktury Alta.

Wygląd kreatora jest inspirowany demonstracją Katie: pełny ekran, cztery etapy w górnym pasku, postać Kaśki po lewej, edytor pośrodku i lawendowy panel podglądu po prawej. Postać jest własną wygenerowaną ilustracją (obraz statyczny, nie awatar mówiący). Asset: `web/assets/kaska.png`; narzędzie i pełny prompt: `web/assets/kaska-prompt.txt`. Motyw wizualny: `web/theme.css`.

## Uruchomienie

W PowerShell w katalogu projektu:

```powershell
Copy-Item .env.example .env
python app.py
```

Otwórz http://localhost:8787. Kolejne uruchomienia: `python app.py` lub `./start.ps1`. Serwer nasłuchuje wyłącznie na 127.0.0.1. Nie wymaga instalacji zależności ani konta w LeadStrong. Nie uruchamiaj równocześnie kilku instancji na tej samej bazie.

## Praca z systemem

Na liście kampanii i w jej szczegółach przycisk **Edytuj** otwiera kreator z zapisaną ofertą, odbiorcami, tagami, materiałami, warunkami i sekwencją. Zapis aktualizuje tę samą kampanię. W szkicu usuwa poprzednio przygotowane wiadomości — użyj ponownie **Przygotuj wiadomości**. Zapis w kampanii aktywnej lub wstrzymanej pozostawia ją wstrzymaną i zachowuje historię. Kroki, z których wysłano już wiadomość lub wysyłka jest niepotwierdzona, są zablokowane. Zmiana treści przyszłego kroku lub oferty odświeża oczekujące wiadomości według szablonów, a usunięcie kroku lub odbiorcy anuluje odpowiadające mu oczekujące wiadomości. Przycisk **Przygotuj wiadomości** jest dostępny również po wstrzymaniu: uzupełnia nowe kroki i nowych odbiorców, zachowując wysłane, anulowane i usunięte wiadomości. Wysyłkę wznawiasz osobno. Szkice edycji w przeglądarce są oddzielne dla każdego projektu i kampanii; równoczesny zapis starszej wersji jest odrzucany.

1. Dodaj kontakty ręcznie lub zaimportuj CSV. Wymagana kolumna `email`, opcjonalne `name,company,role,notes`. Przykład: `examples/contacts.csv`. Duplikaty adresów są pomijane. Nieprawidłowy adres wycofuje cały import.
2. Utwórz kampanię w czterech etapach: **Odbiorcy → Oferta → Sekwencja → Ustawienia**. Wybierz wszystkie aktywne kontakty, konkretną listę albo dobór przez sygnały. Ofertę wpisz ręcznie lub pobierz z dowolnej strony firmy. Dni sekwencji muszą rosnąć: np. 0, 3, 7. Zmienne w treści: `{{name}}`, `{{company}}`, `{{role}}`, `{{offer}}`, `{{audience}}`, `{{notes}}`.
3. Zapisz szkic i wybierz **Przygotuj wiadomości**. System zapisze wiadomości dla odbiorców zgodnych z wybranym trybem. Opis grupy docelowej jest kontekstem dla treści, a faktyczny wybór kontaktów wynika z listy albo reguły sygnałów. Nowe kontakty można znaleźć i zweryfikować przez Hunter w zakładce **Znajdź klientów**.
4. Sprawdź i w razie potrzeby popraw zapisane wiadomości. Ponowne przygotowanie szkicu zastępuje poprzednie wiadomości kampanii. Bez podłączonego AI działa personalizacja szablonów. Z AI przygotowanie trwa odpowiednio dłużej.
5. Po konfiguracji SMTP wybierz **Uruchom wysyłkę**. Dopiero ta operacja upoważnia kolejkę do wysyłania. Nowe kontakty nie są automatycznie dołączane do wcześniej przygotowanej kampanii.
6. Obserwuj statusy oraz zakładkę Odpowiedzi. Możesz wstrzymać kampanię lub dany kontakt. Zatrzymanie kontaktu anuluje jego oczekujące wiadomości we wszystkich kampaniach.

Nie ma demonstracyjnych kontaktów, wygenerowanych statystyk ani pozorowanej wysyłki. Dane interfejsu pochodzą z bazy. Widoki pobierają maksymalnie 2000 ostatnich rekordów danej tabeli; przy większej bazie potrzebna jest paginacja.

## Uniwersalny kreator i biblioteka treści

Aplikacja nie ma domyślnego klienta, domeny ani branży. Można działać bez strony internetowej, opisując ofertę ręcznie, albo podać dowolną publiczną stronę HTTPS. Każda kampania zapisuje stronę nadawcy, ofertę, problemy klientów, argumenty, język PL/EN i opcjonalne wezwanie do działania z linkiem. Jest to jedna lokalna przestrzeń robocza z projektami firm — nie wdrożono kont wielu organizacji ani izolacji użytkowników SaaS.

Projekt edytuje się na osobnej stronie **Szczegóły**, dostępnej pod listą projektów w pasku bocznym (`#project`). Oferta, problemy, propozycje wartości, dowody, opis odbiorców, języki wyszukiwania i obszary są wspólne dla Odkrywania firm i Pozyskiwania leadów. Te widoki nie powielają formularza projektu. Przycisk **+** tworzy projekt i otwiera jego edycję, a ikona kosza usuwa projekt po potwierdzeniu. Kampania może pobrać te treści przyciskiem **Importuj z projektu**.

Przy tworzeniu projektu opcja **Współdziel kontakty** wybiera wspólną pulę kontaktów i tagów. Domyślnie nowy projekt ma własną bazę. Ten sam email może występować osobno w różnych prywatnych projektach. Kampanie, ich wiadomości i odpowiedzi należą do konkretnego projektu; odbiorcy pochodzą z jego puli kontaktów. Usunięcie projektu wstrzymuje jego kampanie i reguły sygnałów. Migracja zachowuje dotychczasową wspólną pulę kontaktów i przypisuje kampanie do projektu wskazanego przez wyszukiwanie, a pozostałe do pierwszego istniejącego projektu. Zachowuje identyfikatory i historię wiadomości.

Niezależna opcja **Współdziel monitoringi** łączy projekty ze wspólną pulą monitoringów ofertowych i tematycznych oraz ich źródeł. Nowy monitoring i jego usunięcie są widoczne we wszystkich projektach z tą opcją. Oceny firm pozostają osobne dla ofert projektów. Po usunięciu twórcy wspólnego monitoringu zachowujemy go w innym projekcie z tej puli; zatrzymujemy go po usunięciu ostatniego uczestnika. Domyślnie opcja jest wyłączona, również dla dotychczasowych projektów.

Wiadomości w kampanii mają paginację z wyborem 10/25/50/100 pozycji. Checkbox **Operacje zbiorcze** włącza wybieranie wiadomości i usuwanie zaznaczonych; wybór pozostaje przy zmianie strony, a checkbox w nagłówku obejmuje tylko bieżącą stronę. Usuwanie wymaga wstrzymania aktywnej kampanii i potwierdzenia. Usunięcie oczekującego kroku anuluje późniejsze oczekujące kroki tej osoby. Rekordy wysłanych wiadomości pozostają w bazie dla historii doręczeń, dopasowania odpowiedzi i limitów wysyłki, a usunięte pozycje znikają z listy.

Kreator ma panel pomocy z działającymi skrótami, edytor sekwencji i podgląd dla wybranego aktywnego kontaktu. Panel pomocy jest przewodnikiem, a nie pozorowanym czatem AI. Podgląd personalizuje szablon bez wywoływania modelu; generowanie AI odbywa się podczas przygotowania wiadomości, jeśli skonfigurowano model. Odpowiedzi i rezygnacje zatrzymują sekwencję; ta wersja nie ma graficznego edytora dowolnych rozgałęzień ani wysyłki LinkedIn.

Niezapisany formularz jest zachowywany w localStorage tej przeglądarki i przywracany po ponownym otwarciu kreatora. Nie jest to szkic zapisany na serwerze. Finalny przycisk zapisuje kampanię w SQLite. Sam zapis nie uruchamia wysyłki.

**Biblioteka → Dodaj stronę firmy** odczytuje stronę główną i do 10 podstron opisujących usługi, produkty, artykuły, realizacje lub case studies. Są to publiczne treści HTML — bez logowania, wykonywania JavaScript i odczytu plików PDF. Można dodać konkretną podstronę z tej samej domeny. Treści trafiają do projektu danej domeny; można wyłączyć materiał z dalszego doboru. Opisy pochodzą z meta description lub fragmentu odczytanej strony i wymagają sprawdzenia. Import może potrwać do kilkudziesięciu sekund zależnie od liczby i szybkości stron.

W kampanii wybierz sposób użycia materiałów:

- **Bez dodatkowego materiału** — sama treść wiadomości.
- **Dobierz według kontekstu** — ranking podobieństwa słów w stanowisku, notatkach, grupie docelowej, problemach i sygnale. Bez dopasowania link nie jest dodawany.
- **Wybór ręczny** — wybierz materiały, spośród których zostanie dołączony jeden najlepiej dopasowany; przy braku kontekstu używany jest jeden z wybranych.

Wybierane są wyłącznie włączone materiały z domeny nadawcy danej kampanii. Ranking jest heurystyczny, niezależny od branży, nie jest potwierdzeniem biznesowej trafności. Dostępne zmienne: `{{material_title}}`, `{{material_url}}`, `{{material_summary}}`, `{{cta}}`, `{{cta_url}}`. Wybrany link oraz link CTA są dopisywane, jeśli nie występują już w treści. Są to bezpośrednie adresy istniejących stron; nie dodano śledzenia kliknięć ani publikacji nowych stron.

API biblioteki: `POST /api/library/discover` z `website`, `POST /api/library/add` z `website,url`, `POST /api/library/status` z `id,enabled`. Podgląd: `POST /api/campaign/preview` z parametrami kampanii, `steps`, `preview_contact_id` i `preview_step`. Wszystkie wymagają tokenu CSRF. Kampanie przyjmują `audience_mode` (`all/selected/signals`), `contact_ids`, `material_mode` (`none/auto/manual`), `material_ids`, `website`, `language`, `cta`, `cta_url`, `pain_points` i `value_props`.

## Poczta

Dla Gmaila / Google Workspace wejdź w **Integracje → Podłącz Gmail**. Podaj adres konta i hasło aplikacji Google. Aplikacja sprawdzi logowanie SMTP i IMAP i dopiero po sukcesie zapisze dane w lokalnym `.env`. Nie wysyła wiadomości testowej. Nie podawaj hasła w czacie. Hasła aplikacji mogą być niedostępne w zależności od ustawień konta i polityki administratora. Instrukcja: https://support.google.com/a/answer/176600. Panel obsługuje podłączenie bez ponownego uruchamiania serwera.

Uzupełnij `.env` i uruchom serwer ponownie. Nie wpisuj sekretów do repozytorium. Plik `.env` jest ignorowany przez Git.

```ini
SMTP_HOST=smtp.twoj-dostawca.pl
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_USER=adres@twoja-firma.pl
SMTP_PASSWORD=haslo-aplikacyjne
SMTP_FROM=Imie Nazwisko <adres@twoja-firma.pl>
IMAP_HOST=imap.twoj-dostawca.pl
IMAP_PORT=993
IMAP_USER=adres@twoja-firma.pl
IMAP_PASSWORD=haslo-aplikacyjne
DAILY_SEND_LIMIT=50
SEND_INTERVAL_SECONDS=60
```

Alternatywnie dla SMTP TLS od początku połączenia: `SMTP_SECURITY=ssl` i port właściwy dla dostawcy (często 465). Logowanie jest przez SMTP/IMAP z hasłem lub hasłem aplikacyjnym. Ta wersja nie ma OAuth do Microsoft Graph ani Gmail API; jeżeli organizacja blokuje SMTP AUTH/IMAP z hasłem, potrzebna będzie odpowiednia integracja OAuth lub inny serwer poczty. Obecność ustawień w panelu nie potwierdza poprawności połączenia.

Limit dzienny jest liczony według UTC i obejmuje potwierdzone wysyłki ze wszystkich kampanii. Kolejne kroki zachowują zadany odstęp względem rzeczywistej wysyłki poprzedniego kroku, również po przerwie w działaniu aplikacji. Po wznowieniu kampanii zaległe wiadomości wysyłają się z zachowaniem limitu i odstępu między wysyłkami. Po sukcesie SMTP status oznacza przyjęcie przez serwer, a nie potwierdzenie doręczenia lub odczytu.

Nieudana lub przerwana próba SMTP otrzymuje status **Sprawdź wysyłkę**. System nie ponawia jej automatycznie, ponieważ serwer mógł przyjąć wiadomość przed utratą połączenia. Sprawdź skrzynkę i przyczynę błędu przed przygotowaniem kolejnej kampanii.

## Odpowiedzi i rezygnacja

Co minutę, przed dalszym wysyłaniem, IMAP sprawdza ostatnie 200 wiadomości w INBOX. Ręczne sprawdzenie: **Odpowiedzi → Synchronizuj pocztę**. Rozpoznanie wymaga dopasowania nadawcy do kontaktu oraz nagłówka In-Reply-To lub References do wysłanej wiadomości. Każda rozpoznana odpowiedź, również automatyczna, zatrzymuje sekwencje danej osoby. Odpowiedzi z innego adresu, bez nagłówków powiązania, poza INBOX lub poza ostatnimi 200 wiadomościami mogą wymagać ręcznego zatrzymania kontaktu. Przy błędzie skonfigurowanej integracji IMAP dana iteracja automatycznej wysyłki jest pomijana.

Wiadomość zawiera instrukcję odpowiedzi STOP oraz podpisany link rezygnacji z potwierdzeniem. Dla odbiorców spoza komputera `PUBLIC_BASE_URL` musi prowadzić do działającej instancji przez HTTPS. Link localhost nie zadziała zdalnie. Ta wersja jest lokalna i nie instaluje publicznego hostingu. Wdrożenie wymaga reverse proxy kierującego do 127.0.0.1 z lokalnym nagłówkiem Host i udostępniającego publicznie wyłącznie `/unsubscribe`; panel i API powinny pozostać prywatne. Klucz linków jest zapisywany w `data/unsubscribe.key` — zachowaj go razem z bazą przy migracji. Samo otwarcie linku nie zmienia statusu; wymagane jest kliknięcie potwierdzenia.

## Panel Kaśki i schemat sekwencji

W kreatorze panel Kaśki ma dwa skróty: **Stwórz ofertę z naszej strony** oraz **Zbuduj ofertę z historii sukcesu**. Podaj stronę nadawcy, a następnie wybierz skrót. Oferta pojawia się w edytowalnym podglądzie; dopiero **Zastosuj ofertę** wpisuje ją do kampanii. Wariant historii sukcesu wymaga OpenAI, odczytuje podlinkowane case studies lub bezpośrednio podaną realizację i wykorzystuje sprawdzone względem odczytanej treści cytaty. Przy braku historii lub dowodów pokazuje komunikat i zachowuje obecną ofertę. Cytaty i źródła trafiają do proof points po zatwierdzeniu.

W etapie **Sekwencja** diagram pokazuje bramkę wejściową, wiadomości i warunki między krokami. Kliknij wybrany **+**, a następnie **Warunek**, aby wstawić go w tym miejscu. Przycisk **Warunek** na pasku również korzysta z ostatnio wybranego plusa; domyślnie wstawia na końcu. Kliknięcie istniejącego warunku otwiera jego edycję. Dostępne pola: email, firma, stanowisko; operatory: jest ustawione, nie jest ustawione, zawiera, jest równe, nie zawiera. Wszystkie reguły w bloku muszą być spełnione. „Tak” prowadzi dalej, „Nie” do **Pomiń odbiorcę**: pozostałe oczekujące wiadomości tej osoby w kampanii są anulowane, bez zmiany jej globalnego statusu. Warunki między wiadomościami są sprawdzane po dojściu kolejki do wskazanego miejsca, więc nie blokują wcześniejszych emaili. Warunki wejściowe nadal filtrują przygotowanie i są sprawdzane przed wysyłką. Pozycje zapisują się w lokalnym szkicu i kampanii, a symulacja również obsługuje gałąź „Nie”.

Kliknięcie karty email wybiera krok do edycji. Kaśka udostępnia **Popraw treść tego kroku z AI** i **Napisz pierwszą wiadomość z AI**, z opcjonalnymi uwagami dotyczącymi stylu. Wynik ma osobny podgląd i zmienia tylko wskazany krok po zastosowaniu. Nie uruchamia wysyłki. Funkcje AI wymagają klucza OpenAI i mogą zużywać środki API. Panel i skróty są dostępne także na telefonie.

## Język Kaśki i wiadomości

W nagłówku panelu wybierz **Język Kaśki: Polski / English**. To zmienia interfejs oraz język nowych ocen dopasowania AI. W **Integracje → Języki** ustawisz również domyślny język nowych wiadomości: polski, angielski, niemiecki, francuski, hiszpański lub włoski. Ustawienia zapisują się w bazie tej przestrzeni roboczej i pozostają po restarcie.

Język wiadomości można niezależnie wybrać w **Znajdź klientów** i kreatorze kampanii. Zapisuje się przy wyszukiwaniu i kampanii; późniejsza zmiana ustawień domyślnych nie zmienia istniejących kampanii. AI otrzymuje wyraźne polecenie pisania w języku kampanii. Szablony, etykiety materiałów, domyślne wezwania do działania i stopki rezygnacji obsługują wszystkie sześć języków.

Przełączanie interfejsu nie tłumaczy ani nie nadpisuje wpisanej oferty, wiadomości i pobranych dowodów. Bez OpenAI ofertę oraz własne szablony trzeba wpisać w docelowym języku. W kreatorze zmiana języka aktualizuje tylko domyślne, nieedytowane tematy i treści. Ręcznie edytowane szkice zostają zachowane. Zapisane wcześniej oceny i dane źródłowe pozostają w języku, w którym powstały.

## Znajdowanie klientów i zapisywanie kontaktów

Dashboard korzysta z oferty i kryteriów bieżącego projektu. Pole **Doprecyzuj wyszukiwanie (opcjonalnie)** dodaje warunek tylko do danego wyszukiwania. Puste pole uruchamia wyszukiwanie według projektu. Doprecyzowanie pozostaje w roboczym opisie w Leadach i nie zmienia projektu. Link **Zmień kryteria** otwiera jego szczegóły.

Dashboard i Leady pokazują ten sam panel wyszukiwania. Doprecyzowanie jest zachowane przy przejściu i odświeżeniu strony, osobno dla każdego projektu. W Leadach pełny opis i przycisk **Sformułuj z AI** znajdują się w domyślnie zwiniętym wyszukiwaniu zaawansowanym.

W wyszukiwaniu zaawansowanym **Język wyszukiwania** steruje tłumaczeniem opisu i językiem propozycji **Sformułuj z AI**. Przy otwarciu panelu, zmianie języka i przed wyszukiwaniem podłączone OpenAI tłumaczy opis roboczy, zachowując kryteria. Opis i wybrany język pozostają w sesji przeglądarki, osobno dla projektu. Błąd tłumaczenia nie usuwa tekstu; bez OpenAI opis można wpisać ręcznie w wybranym języku. Projekt nie jest zmieniany.

W zakładce **Leady** opis wyszukiwania łączy ofertę i kryteria projektu, a przycisk **Sformułuj z AI** proponuje jego treść. Opis roboczy pozostaje w sesji przeglądarki. Hunter wyszukuje firmy i osoby, zapisuje źródła oraz sprawdza adresy email. Wyniki są pogrupowane w rozwijane firmy podobnie jak w Odkrywaj. Wybierz osoby, opcjonalnie dodaj tagi przy każdej z nich i kliknij **Dodaj wybrane do kontaktów**. Nie powstaje kampania ani wiadomości. Kontakty bez aktualnej weryfikacji zapisujemy jako wstrzymane; istniejące kontakty zachowują status, a nowe tagi są dopisywane. W symulacji można zapisać fikcyjne kontakty bez tagów; pozostają oznaczone i wykluczone z rzeczywistej wysyłki. Kampanie tworzysz osobno w zakładce Kampanie, wybierając kontakty lub ich tagi. Własny klucz Hunter podłączysz w Integracjach. Instrukcja, koszty i ograniczenia: [PROSPECTING.md](PROSPECTING.md).

## Opcjonalna personalizacja AI

W formularzu nowej kampanii można wpisać adres dowolnej firmy i kliknąć **Pobierz opis firmy**. Serwer odczytuje publiczny HTML przez HTTPS, blokuje adresy prywatne oraz sprawdza przekierowania. Bez AI proponuje opis ze strony; po podłączeniu modelu również analizuje ofertę i proponuje odbiorców. Strony wymagające logowania lub renderujące całą treść w JavaScript mogą wymagać ręcznego wpisania opisu. Nie ma stałego przypisania do jednej firmy.

W **Integracje → ChatGPT / OpenAI** wpisz klucz API i kliknij **Sprawdź i zapisz**. Test wykonuje krótkie płatne zapytanie; konfiguracja jest zapisywana tylko po udanym generowaniu i działa bez restartu. Puste pole klucza zachowuje poprzedni klucz przy zmianie modelu. **Odłącz OpenAI** usuwa go z aktywnej konfiguracji i pliku `.env`.

Alternatywnie uzupełnij `.env` i uruchom aplikację ponownie:

```ini
OPENAI_API_KEY=twoj-klucz-api
OPENAI_MODEL=gpt-6-luna
```

Klucz utworzysz na [OpenAI Platform](https://platform.openai.com/api-keys). API ma osobne rozliczenia od abonamentu ChatGPT. Wybrany model musi obsługiwać Responses API i Structured Outputs. Domyślny model można zmienić w panelu. Integracja używa HTTPS, schematu JSON i `store:false`; klucz pozostaje po stronie serwera. Dokumentacja: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

System wysyła do OpenAI dane kontaktu, ofertę, szablon, kontekst sygnału i materiału; przy analizie strony — jej publiczny tekst. Klucz jest zapisany jawnie w lokalnym `.env`, pomijanym przez Git. Bez `OPENAI_API_KEY` działa personalizacja szablonów. Błąd API przerywa przygotowanie i zachowuje poprzednie szkice. Treść sprawdza użytkownik przed uruchomieniem kampanii. Podgląd szablonu w kreatorze nie wywołuje API.

Widok **Drzewo / Lista** w etapie **Sekwencja** zachowuje te same wiadomości. Planszę można przeciągać, powiększać przyciskami +/− lub Ctrl + kółko myszy i dopasować przyciskiem **Wyśrodkuj**. Kliknięcie karty otwiera edycję kroku. Przyciski + przed, między i po wiadomościach pozwalają wybrać email lub warunek. Wstawianie emaila zachowuje rosnące dni wysyłki (maksymalnie 6 wiadomości i 10 reguł warunków). Preferencja widoku zapisuje się w przeglądarce.

**Wróć do szablonów** udostępnia sekwencje 1, 2 lub 3 wiadomości. Wybranie szablonu zastępuje treść bieżących kroków, zachowując ofertę i warunki. Nadawca pokazuje skonfigurowaną skrzynkę SMTP; aplikacja obsługuje obecnie jedną skrzynkę.

## Dane i testy

Kampanię usuniesz przyciskiem **Usuń kampanię** na liście lub w szczegółach, po potwierdzeniu. Znika z interfejsu, oczekujące wiadomości są anulowane, a kroki, reguły sygnałów i powiązanie z wyszukiwaniem są usuwane. Kontakty, odpowiedzi i zapis wysłanych wiadomości pozostają w bazie dla wykrywania odpowiedzi oraz limitów wysyłki. Usuniętej kampanii nie można ponownie uruchomić ani przywrócić w interfejsie.

Stan przechowywany jest w `data/katie.sqlite3`, sekrety w `.env`. Zatrzymaj aplikację przed wykonywaniem kopii folderu `data/`. Zatrzymanie procesu zatrzymuje wysyłkę; aplikacja nie instaluje usługi Windows.

```powershell
python -m unittest discover -s tests -v
node --check web/app.js
```

Testy korzystają z osobnej tymczasowej bazy i atrap usług pocztowych. Nie wysyłają prawdziwych wiadomości.

## Grupy docelowe kontaktów

Pod tytułem formularza dodawania kontaktu pole „Grupa docelowa” pozwala wybrać istniejącą nazwę lub wpisać nową. Przypisanie jest opcjonalne i trwałe. W Kontaktach można zmienić grupę, usunąć przypisanie przez wyczyszczenie pola oraz filtrować listę według grupy. Grupy i tagi dotyczą puli kontaktów wybranej przy tworzeniu projektu.

Przy imporcie CSV można wskazać grupę dla całej paczki. Opcjonalna kolumna `target_group` nadpisuje ten wybór dla konkretnego wiersza; istniejące kontakty o tym samym adresie email są pomijane bez zmiany ich grupy.

## Zakres pierwszej wersji

Kontakty mają **tagi**, np. `produkcja; ERP; Polska`, zamiast pojedynczej listy. W kampanii wybierz **Według tagów**, zaznacz tagi i dopasowanie **LUB** albo **I**. Dotychczasowe listy i kampanie są migrowane automatycznie. Szczegóły: [CONTACT-TAGS.md](CONTACT-TAGS.md).

Interfejs korzysta ze spójnej terminologii PL/EN: kontakty, leady, prospekty, firmy docelowe, ICP i listy kontaktów. Definicje znajdziesz w **Słowniku sprzedaży** w nagłówku oraz w [TERMINOLOGY.md](TERMINOLOGY.md). Ocena dopasowania przez AI nie oznacza potwierdzonego zainteresowania zakupem.

Na **Dashboardzie** kafelek mapy, umieszczony zaraz po Kontaktach, otwiera zbiorczą mapę na cały ekran. Zamknij ją przyciskiem lub klawiszem Esc. Mapa zbiera obszary aktywnego projektu i wszystkich jego monitoringów. Takie same środki z takim samym promieniem są pokazywane raz; mapa dopasowuje widok do całego zasięgu. Nazwy pod mapą przybliżają wybrany obszar. Zmiana projektu zmienia zawartość mapy.

Przy tworzeniu kampanii w kroku **Odbiorcy** wybierz **Z grupy docelowej** i wskaż grupę kontaktów. Kreator pokazuje liczbę aktywnych osób i ogranicza do nich listę podglądu. Grupa zapisuje się w szkicu oraz kampanii; przygotowanie wiadomości obejmuje jej aktywnych członków w chwili generowania. Pusta lub nieistniejąca grupa nie zastępuje wyboru całą bazą. Osoby wstrzymane i wypisane są pomijane. Zapis kampanii nie uruchamia wysyłki.

Gotowe integracje danych: **Google News RSS, GDELT DOC 2.0, Greenhouse Job Board i Lever Postings**. Konfiguracja w **Sygnały → Źródła**; nie trzeba wpisywać adresów API. Dostępność i ograniczenia: [DATA-SOURCES.md](DATA-SOURCES.md).

Dodano moduł **Sygnały**: 50 typów detekcji, monitorowanie RSS/Atom i zmian HTML, źródła JSON, dowody, priorytety, akceptacja i reguły automatycznego dołączania odbiorców do kampanii. Instrukcja i format danych: [SIGNALS.md](SIGNALS.md). Źródła danych trzeba podłączyć — liczba typów nie oznacza dostępu do płatnych baz dostawców.

Gotowe: CRUD w zakresie dodawania i wstrzymywania kontaktów, import CSV, sekwencje, edycja spersonalizowanych szkiców, opcjonalne OpenAI API, kolejka SMTP, limity, IMAP i zatrzymanie po odpowiedzi, rezygnacje, dziennik zdarzeń oraz trwała baza.

Do rozbudowy według potrzeb: automatyczne wyszukiwanie i wzbogacanie leadów, LinkedIn, integracja CRM, OAuth poczty, kalendarz i rezerwacja spotkań, konta zespołu, wdrożenie serwerowe oraz obsługa dużych baz. Ta wersja nie udaje tych integracji.
