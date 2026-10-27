# Pierwszy etap: od opisu odbiorców do szkiców

Pod opisem firm znajduje się rozwijana lista **Szukaj w językach** z checkboxami dla polskiego, angielskiego, niemieckiego, francuskiego, hiszpańskiego i włoskiego. Można wybrać kilka języków; brak zaznaczeń oznacza brak ograniczenia. Wybór zapisuje się w profilu, jest dostępny również w edycji profilu Discover i trafia jako preferencja języka rozmowy do zapytania Hunter oraz oceny dopasowania. Historia wyszukiwania zachowuje własną listę wybranych języków. Język wiadomości jest oddzielnym ustawieniem. Język kontaktu z firmą wymaga potwierdzenia — kraj siedziby, domena ani sam wynik wyszukiwarki go nie potwierdzają.

## Uruchomienie

1. Włącz aplikację przez `start.ps1` i otwórz `http://localhost:8787`.
2. W **Integracje → Hunter** podaj własny klucz API z konta Hunter. Przycisk sprawdza dostęp przez `/v2/account`, a następnie zapisuje klucz w lokalnym `.env`. Nie udostępnia klucza przeglądarce. Dostęp do Discover zależy od planu konta; poprawny klucz nie gwarantuje dostępu do każdej funkcji.
3. Opcjonalnie podłącz OpenAI. Bez niego wyszukiwanie i weryfikacja nadal działają, ocena pozostaje „Do ręcznej oceny”, a wiadomości korzystają z szablonów.
4. Otwórz **Znajdź klientów**, wybierz język wiadomości, podaj stronę nadawcy, ofertę i opis firm: branżę, kraj, wielkość i inne kryteria. Jeżeli oferta jest pusta, pobieramy opis z publicznego HTML strony nadawcy. Język Kaśki ustawisz niezależnie w nagłówku lub Integracjach; nowe oceny powstają po polsku albo angielsku. Wiadomości obsługują polski, angielski, niemiecki, francuski, hiszpański i włoski. Bez OpenAI ofertę wpisz w docelowym języku.
5. Wybierz dział lub wpisz stanowiska, limit firm (1–10), osób na firmę (1–3) i wykluczone domeny. Domyślnie skan obejmuje do 3 firm i 2 osób na firmę.
6. Uruchom wyszukiwanie. Wyniki i postęp zapisują się w bazie. Możesz przejść do innej zakładki i wrócić. To nie uruchamia poczty.
7. Przejrzyj źródła, daty, uzasadnienie oraz braki w danych. Kliknij **Zweryfikuj adresy email**. Dostawca może zwrócić także `pending`, `accept_all` lub `unknown`; takie wyniki nie dopuszczają do kampanii. Weryfikację można ponowić ręcznie.
8. Zaznacz osoby, których dopasowanie sprawdziłeś, i kliknij **Utwórz szkice dla wybranych**. Powstaje kampania w stanie `draft` z dwoma wiadomościami na osobę: dzień 0 i 3. Przejrzyj lub edytuj wiadomości w kampanii. Wysyłkę uruchamiasz osobno.

Bezpośredni adres ekranu: `http://localhost:8787/#prospecting`.

Sekcja **Proof points** ma przycisk **Przeczytaj ze strony z AI**. Odczytuje stronę nadawcy oraz do trzech podlinkowanych podstron z tej samej domeny dotyczących realizacji, klientów, referencji lub certyfikatów. AI wybiera krótkie, dosłowne cytaty; aplikacja sprawdza ich obecność w odczytanej treści i zgodność URL z pobranymi stronami. Podgląd pokazuje cytaty i źródła przed zastąpieniem listy. Nie jest to niezależne potwierdzenie prawdziwości twierdzeń firmy. Brak dowodów lub błąd nie zmienia istniejących punktów. Cytaty zachowują język źródła. Proof points zapisują się z wyszukiwaniem, szkicem kreatora i kampanią oraz trafiają do kontekstu generowania wiadomości. Można je też wpisać i edytować ręcznie. Skan wymaga OpenAI i może zużywać środki API.

Pod ofertą są listy **Problemy odbiorców (Pain points)** i **Propozycje wartości (Value propositions)**, podobne do kreatora kampanii. Dodawaj punkty przez „+”, usuwaj przez „×”. Każda lista mieści do 10 punktów po 500 znaków. **Zaproponuj z AI** tworzy propozycje na podstawie oferty i opisu odbiorców w wybranym języku wiadomości. Przed zastosowaniem zobaczysz edytowalny podgląd. Problemy są hipotezami, a korzyści wymagają potwierdzenia; AI nie powinno dopisywać nieudokumentowanych procentów lub wyników. Punkty zapisują się z wyszukiwaniem i kampanią oraz trafiają do oceny dopasowania i generowania wiadomości. W kreatorze są również zachowywane w lokalnym szkicu.

Stronę możesz podać jako samą domenę, np. `firma.pl` lub `www.firma.pl`. Aplikacja automatycznie dodaje `https://`; pełny adres HTTPS również jest obsługiwany. Dotyczy to wyszukiwania klientów, skanowania oferty, strony nadawcy w kreatorze i stron w bibliotece.

Pod **Ofertą** przycisk **Skanuj stronę i opisz ofertę** odczytuje publiczny HTML adresu wpisanego powyżej i uzupełnia opis oferty. Pokazuje link do odczytanej strony. Z podłączonym OpenAI opis jest analizowany w wybranym języku wiadomości; bez AI pobierany jest opis strony, który trzeba sprawdzić i ewentualnie przetłumaczyć. Przycisk nie zmienia opisu odbiorców i nie uruchamia wyszukiwania klientów. Zmianę można cofnąć, a edycja wykonana podczas skanowania pozostaje zachowana — wynik czeka wtedy jako osobna propozycja. Strony wymagające logowania lub renderowania JavaScript mogą nie udostępnić tekstu.

Przy **Ofercie** i **Opisie firm** znajdziesz przycisk **Fine tune with AI**. Redaguje wpisany tekst po kliknięciu, bez uruchamiania wyszukiwania. Oferta jest poprawiana w wybranym języku wiadomości, a opis odbiorców w języku Kaśki. AI ma zachować fakty i kryteria, ale wynik nadal wymaga sprawdzenia. Poprawkę można cofnąć. Jeśli zmienisz tekst podczas oczekiwania, propozycja pojawi się osobno do zastosowania. Błąd pozostawia Twoją treść bez zmian. Funkcja wymaga OpenAI i wykonuje płatne zapytanie API.

## Dane i ograniczenia

**Utwórz szkice dla wybranych** uruchamia zadanie w tle. Wyniki pokazują licznik gotowych wiadomości, aktualizowany co kilka sekund. Możesz przechodzić między zakładkami; po zakończeniu kampania jest dostępna przy wynikach. Gdy pozostajesz przy tym wyszukiwaniu, otwiera się automatycznie. Błąd jest widoczny w wynikach i pozwala ponowić próbę. Zamknięcie karty nie przerywa zadania, ale restart serwera je przerywa. Nie uruchamiamy ponownie płatnych zapytań automatycznie.

- Hunter Discover interpretuje opis firm i zwraca kandydatów. Zastosowane filtry zapisujemy i pokazujemy w wynikach. Samo znalezienie firmy nie potwierdza wszystkich kryteriów ICP.
- Domain Search pobiera osobiste, publicznie znalezione adresy osób oznaczonych przez Hunter jako decydenci. Wymagamy imienia i nazwiska oraz publicznego źródła. Nie zgadujemy emaili, nie importujemy adresów `inferred` ani skrzynek ogólnych.
- Opis firmy pochodzi z jej strony HTTPS, pobieranej z ochroną przed dostępem do prywatnych adresów. Jeżeli odczyt się nie uda, pokazujemy ostrzeżenie. Nie zamieniamy braku danych w wymyślony profil.
- Z OpenAI kandydaci otrzymują ocenę `matched`, `uncertain` lub `rejected` i uzasadnienie na podstawie dostępnych danych. To sugestia wymagająca przeglądu. Dane ze stron i dostawcy traktowane są jako nieufny kontekst, nie instrukcje.
- Pole „Dlaczego teraz” wykorzystuje wyłącznie zaakceptowane sygnały z ostatnich 30 dni, których URL należy do domeny firmy. Brak sygnału jest jawnie pokazywany. Nie wykonujemy w tym etapie automatycznego pełnego researchu mediów ani nie przypisujemy artykułów do firm na podstawie samej nazwy.
- Własna domena, jej subdomeny, podane wykluczenia i emaile już obecne w Kontaktach są pomijane. Przed zapisem kampanii ponownie sprawdzamy, czy kontakt nie pojawił się w bazie podczas generowania.
- Do kampanii dopuszczamy tylko wynik `valid`, sprawdzony w aplikacji w ostatnich 7 dniach, z datą weryfikacji dostawcy nie starszą niż 31 dni. Wynik nie gwarantuje dostarczenia przyszłej wiadomości.
- Nie ma automatycznych ponowień płatnych wywołań. Przerwane operacje są oznaczane po restarcie. Wyniki częściowe pozostają w bazie; ponowienie tworzenia tej samej kampanii zwraca jej istniejący identyfikator.
- Przy błędzie generowania nie powstają częściowe kontakty, kampanie ani wiadomości. Zatrzymanie po odpowiedzi i rezygnacji obsługuje istniejący mechanizm SMTP/IMAP; IMAP musi być poprawnie podłączony.

## Koszty i klucze

Wyszukiwanie osób i weryfikacja mogą zużywać kredyty Hunter. Przy włączonym OpenAI analiza dopasowania wykonuje do jednego zapytania na osobę, a przygotowanie dwóch wiadomości do dwóch zapytań na wybraną osobę. Limity formularza ograniczają wielkość pojedynczego zadania. Nie są limitem wydatków całego konta.

Do Hunter trafiają kryteria wyszukiwania firm, domeny, filtry stanowisk i adresy do weryfikacji. Do OpenAI trafiają oferta, opis odbiorców, dane kandydatów i pobrany kontekst. Oba klucze są zapisane jawnie w lokalnym `.env`, pomijanym przez Git. Nie wpisuj ich na czacie.

Ręczna konfiguracja: `HUNTER_API_KEY=...` w `.env`, następnie restart aplikacji.

Dokumentacja dostawcy: [Hunter API](https://hunter.io/api-documentation).

## Obszary na mapie

Pod opisem odbiorców checkbox „Pokaż mapę” odsłania mapę Leaflet/OpenStreetMap. Kliknięcie wybiera współrzędne; promień 1–1000 km i opcjonalna nazwa pozwalają dodać do 10 obszarów. Można też wpisać współrzędne ręcznie. Wybrane koła tworzą sumę obszarów. Ukrycie mapy nie usuwa filtra. Obszary można usuwać pojedynczo lub wyczyścić wszystkie; są zapisywane per profil w `search_areas`, wspólne dla Discover i wyszukiwania, niezależne od opisu odbiorców i języków.

Każde wyszukiwanie zapisuje własną kopię obszarów. Współrzędne, nazwy i promienie są przekazywane w opisie zapytania do Hunter. Obecne API dostawcy nie potwierdza dokładnego filtrowania po promieniu: wynik z wybranymi obszarami wymaga potwierdzenia lokalizacji, a ocena AI nie może oznaczyć go jako w pełni dopasowany wyłącznie na podstawie wyszukiwarki. Nie dodajemy wymyślonych lokalizacji ani adresów firm.

Leaflet 1.9.4 jest dostarczany lokalnie z licencją w `web/vendor/leaflet`; podkład OSM pobierany jest bezpośrednio przez przeglądarkę dopiero po pokazaniu mapy, z widoczną atrybucją i bez prefetch/offline. Nie wymaga klucza map. Bez podkładu nadal działają ręczne współrzędne i obszary. Test mapy przechwytuje obrazy kafelków, więc automatyczne testy nie obciążają serwisu OSM.

## Weryfikacja implementacji

`python -m unittest discover -s tests -v` oraz `node tests/browser.cjs` sprawdzają przepływ z atrapami usług, bez płatnych zapytań. Serwer testowy i dane przykładowe istnieją wyłącznie w `tests/`; aplikacja użytkownika nie otrzymuje domyślnych firm ani kandydatów. Rzeczywisty odczyt konta, wyszukiwanie i weryfikacja wymagają własnego klucza z uprawnieniami i kredytami.
