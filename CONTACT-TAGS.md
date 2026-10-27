# Tagi kontaktów i odbiorcy kampanii

Kontakt może mieć do 30 tagów. W polu **Tagi kontaktu** wybierz istniejący tag z listy rozwijanej albo wpisz nazwę w stale widocznym polu **Nowy tag** i wybierz **+ Dodaj tag** (działa też Enter). Wybrane tagi pokazują się jako etykiety; krzyżyk usuwa etykietę z kontaktu. Możesz dodać kilka nowych nazw po średniku, np. `produkcja; ERP; Polska`. Nowe tagi zapisują się wraz z kontaktem. Spacje na brzegach i puste pozycje są pomijane. Powtórzenia i różnice wielkości liter nie tworzą dodatkowego tagu; istniejąca pisownia jest zachowana. Maksymalna długość tagu wynosi 100 znaków.

Kampania w trybie **Według tagów** zapisuje wybrane tagi i sposób dopasowania:

- **Dowolny z wybranych tagów (LUB)** — wystarczy jeden wspólny tag.
- **Wszystkie wybrane tagi (I)** — kontakt musi mieć każdy wybrany tag.

Kreator pokazuje liczbę pasujących aktywnych osób oraz dopasowany podgląd. Przy przygotowywaniu wiadomości odczytywane są aktualne tagi kontaktów. Jedna osoba nie jest powielana przy dopasowaniu kilku tagów. Pusta selekcja nie oznacza całej bazy. Reguły dołączania odbiorców na podstawie sygnałów również respektują tagi kampanii. Kontakty wstrzymane, wypisane i oznaczone jako symulacyjne są pomijane przy rzeczywistych kampaniach.

W Discover tagi wybiera się osobno przy każdej znalezionej osobie. Filtry wyszukiwania firmy nie zawierają wyboru tagów. Działa to także dla lokalnych i zapisywanych w bazie kontaktów symulacyjnych. Wskazane tagi są dodawane do istniejących kontaktów, bez usuwania wcześniejszych tagów. Formularz edycji kontaktu zastępuje cały zestaw. Import CSV obsługuje kolumnę `tags` z wartościami rozdzielonymi średnikiem oraz wspólne tagi dla paczki. Dotychczasowa kolumna `target_group` jest nadal przyjmowana dla zgodności.

Przy pierwszym uruchomieniu tej wersji nazwy dotychczasowych list są przenoszone do `contacts.tags`, a kampanie korzystające z list — do `audience_tags` i trybu `tags`. Migracja jest jednorazowa i nie nadpisuje późniejszych edycji tagów. Zachowuje statusy osób i wiadomości. Stare pola pozostają dla zgodności, a interfejs korzysta z tagów.

API: `POST /api/contacts` z `tags` (tekst po średnikach lub tablica); `POST /api/contact/tags` z `id`, `tags`; `POST /api/campaigns` z `audience_mode="tags"`, `audience_tags` i `tag_match="any"` lub `"all"`. `GET /api/state` zwraca tagi osób jako tablice oraz katalog `contact_tags`.

## Operacje zbiorcze

W **Kontaktach** wybierz **Operacje zbiorcze**, zaznacz osoby checkboxami, wybierz tagi z listy lub dodaj nowe i kliknij **Przypisz tagi do zaznaczonych**. Dotychczasowe tagi i statusy pozostają zachowane. Checkbox w nagłówku zaznacza tylko kontakty widoczne po filtrowaniu; wybór osób pozostaje przy zmianie filtra. **Odznacz wszystkie** czyści cały wybór.

`POST /api/contacts/tags/bulk` przyjmuje `ids` (do 2000 identyfikatorów) i `tags`. Przypisanie w bazie jest transakcyjne: brak kontaktu lub przekroczenie limitu tagów odrzuca całą paczkę. Lokalne kontakty z symulacji otrzymują tagi w sesji przeglądarki.

## Administracja

W lewym menu wybierz **Administracja**, następnie rozwiń **Edycja tagów**. Katalog jest wspólny dla profili. Można utworzyć tag przed przypisaniem go do kontaktu; pozostaje dostępny na listach wyboru. Zmiana nazwy aktualizuje przypisania w kontaktach i kampaniach, zachowując statusy osób. Nazwy muszą być unikalne niezależnie od wielkości liter.

Usunięcie wymaga potwierdzenia w oknie aplikacji. Usuwa tag z katalogu, osób i filtrów kampanii, zachowując same kontakty. Powiązane aktywne kampanie zostają wstrzymane, a ich oczekujące wiadomości anulowane, żeby usunięcie warunku nie rozszerzyło automatycznie wysyłki. Pusty zestaw tagów w kampanii nie oznacza wszystkich kontaktów. Widok pokazuje liczbę przypisań do osób i kampanii.

`POST /api/admin/tags` przyjmuje `action="create"`, `name`; `action="rename"`, `id`, `name`; albo `action="delete"`, `id`. Operacje są transakcyjne i wymagają tokenu CSRF. Definicje przechowuje tabela `contact_tag_definitions`; stan panelu znajduje się w `tag_catalog` w `/api/state`.
