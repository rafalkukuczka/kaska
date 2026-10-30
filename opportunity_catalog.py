"""Project preferences only. No detection, monitoring or automation."""

CATALOG = [{'key': 'funding', 'label': 'Nowe finansowanie', 'category': 'Kapitał'},
 {'key': 'seed', 'label': 'Runda seed', 'category': 'Kapitał'},
 {'key': 'series_a', 'label': 'Runda Series A', 'category': 'Kapitał'},
 {'key': 'series_b', 'label': 'Runda Series B+', 'category': 'Kapitał'},
 {'key': 'ipo', 'label': 'Debiut giełdowy', 'category': 'Kapitał'},
 {'key': 'grant', 'label': 'Dotacja', 'category': 'Kapitał'},
 {'key': 'acquisition', 'label': 'Przejęcie firmy', 'category': 'Kapitał'},
 {'key': 'merger', 'label': 'Fuzja', 'category': 'Kapitał'},
 {'key': 'investment', 'label': 'Inwestycja kapitałowa', 'category': 'Kapitał'},
 {'key': 'revenue', 'label': 'Wzrost przychodów', 'category': 'Wzrost'},
 {'key': 'hiring', 'label': 'Rekrutacja', 'category': 'Zespół'},
 {'key': 'sales_hiring', 'label': 'Rekrutacja sprzedaży', 'category': 'Zespół'},
 {'key': 'it_hiring', 'label': 'Rekrutacja IT', 'category': 'Zespół'},
 {'key': 'marketing_hiring', 'label': 'Rekrutacja marketingu', 'category': 'Zespół'},
 {'key': 'leadership_hiring', 'label': 'Rekrutacja kadry zarządzającej', 'category': 'Zespół'},
 {'key': 'new_ceo', 'label': 'Nowy CEO', 'category': 'Zespół'},
 {'key': 'new_cfo', 'label': 'Nowy CFO', 'category': 'Zespół'},
 {'key': 'new_cto', 'label': 'Nowy CTO', 'category': 'Zespół'},
 {'key': 'new_cro', 'label': 'Nowy lider sprzedaży', 'category': 'Zespół'},
 {'key': 'new_cmo', 'label': 'Nowy CMO', 'category': 'Zespół'},
 {'key': 'layoffs', 'label': 'Redukcja zatrudnienia', 'category': 'Zespół'},
 {'key': 'team_growth', 'label': 'Wzrost zespołu', 'category': 'Zespół'},
 {'key': 'new_market', 'label': 'Wejście na nowy rynek', 'category': 'Ekspansja'},
 {'key': 'new_office', 'label': 'Nowe biuro', 'category': 'Ekspansja'},
 {'key': 'new_factory', 'label': 'Nowy zakład', 'category': 'Ekspansja'},
 {'key': 'new_store', 'label': 'Nowy punkt sprzedaży', 'category': 'Ekspansja'},
 {'key': 'international', 'label': 'Ekspansja międzynarodowa', 'category': 'Ekspansja'},
 {'key': 'partnership', 'label': 'Nowe partnerstwo', 'category': 'Wzrost'},
 {'key': 'new_client', 'label': 'Nowy duży klient', 'category': 'Wzrost'},
 {'key': 'award', 'label': 'Nagroda branżowa', 'category': 'Wzrost'},
 {'key': 'product_launch', 'label': 'Premiera produktu', 'category': 'Produkt'},
 {'key': 'service_launch', 'label': 'Nowa usługa', 'category': 'Produkt'},
 {'key': 'pricing_change', 'label': 'Zmiana cennika', 'category': 'Produkt'},
 {'key': 'rebrand', 'label': 'Rebranding', 'category': 'Produkt'},
 {'key': 'website_launch', 'label': 'Nowa strona internetowa', 'category': 'Technologia'},
 {'key': 'app_launch', 'label': 'Premiera aplikacji', 'category': 'Produkt'},
 {'key': 'api_launch', 'label': 'Udostępnienie API', 'category': 'Technologia'},
 {'key': 'integration', 'label': 'Nowa integracja', 'category': 'Technologia'},
 {'key': 'crm', 'label': 'Wdrożenie CRM', 'category': 'Technologia'},
 {'key': 'erp', 'label': 'Wdrożenie ERP', 'category': 'Technologia'},
 {'key': 'cloud', 'label': 'Migracja do chmury', 'category': 'Technologia'},
 {'key': 'ai_adoption', 'label': 'Wdrożenie AI', 'category': 'Technologia'},
 {'key': 'cybersecurity', 'label': 'Inwestycja w bezpieczeństwo', 'category': 'Technologia'},
 {'key': 'certification', 'label': 'Nowa certyfikacja', 'category': 'Technologia'},
 {'key': 'tender', 'label': 'Przetarg / zapytanie ofertowe', 'category': 'Intencja'},
 {'key': 'vendor_search', 'label': 'Poszukiwanie dostawcy', 'category': 'Intencja'},
 {'key': 'event', 'label': 'Wydarzenie / konferencja', 'category': 'Aktywność'},
 {'key': 'demo_request', 'label': 'Prośba o demo', 'category': 'Aktywność'},
 {'key': 'pricing_visit', 'label': 'Wizyta na cenniku', 'category': 'Aktywność'},
 {'key': 'content_download', 'label': 'Pobranie materiału', 'category': 'Aktywność'},
 {'key': 'regulation', 'label': 'Zmiana przepisów', 'category': 'Rynek'},
 {'key': 'market_trend', 'label': 'Trend rynkowy', 'category': 'Rynek'},
 {'key': 'market_news', 'label': 'Wiadomość dotycząca tematu', 'category': 'Rynek'}]


def validate(value):
    if not isinstance(value,list) or len(value)>len(CATALOG) or any(not isinstance(k,str) for k in value):
        raise ValueError("Wybierz pozycje z katalogu projektu.")
    allowed={row["key"] for row in CATALOG}
    if any(key not in allowed for key in value):
        raise ValueError("Nieznana pozycja katalogu projektu.")
    return list(dict.fromkeys(value))
