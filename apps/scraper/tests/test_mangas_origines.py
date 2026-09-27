"""Premier extracteur « prêt » : fiche, chapitres et catalogue sur des fixtures synthétiques reproduisant le thème."""

from datetime import datetime

import pytest
from selectolax.lexbor import LexborHTMLParser

from manhwa_scraper.contract import ManhwaStatus, ManhwaType
from manhwa_scraper.extractors.parsing import PARIS
from manhwa_scraper.extractors.sites import default_registry
from manhwa_scraper.extractors.sites.mangas_origines import MangasOriginesExtractor
from manhwa_scraper.fetching import FetchError

from .fakes import FakeFetcher, fixture

SERIES = "https://mangas-origines.fr/oeuvre/lame-d-ombre/"
CATALOG = "https://mangas-origines.fr/oeuvre/?m_orderby=latest"
CATALOG_2 = "https://mangas-origines.fr/oeuvre/page/2/?m_orderby=latest"


def test_is_ready_and_runnable_from_the_cli() -> None:
    assert default_registry().get("mangas-origines") is MangasOriginesExtractor
    assert MangasOriginesExtractor.ready


async def test_scrapes_a_series_page_in_a_single_request() -> None:
    fetcher = FakeFetcher()
    fetcher.add(SERIES, fixture("mangas_origines_series.html"))

    manhwa = await MangasOriginesExtractor(fetcher).scrape_series(SERIES)

    assert manhwa.title == "Lame d'ombre"
    assert manhwa.synopsis == "Un escrimeur sans nom traverse les royaumes."
    assert str(manhwa.cover_url) == "https://mangas-origines.fr/wp-content/uploads/2024/01/lame-714x1024.jpg"
    assert (manhwa.status, manhwa.type) == (ManhwaStatus.ongoing, ManhwaType.manhwa)
    assert len(fetcher.calls) == 1  # la liste des chapitres est dans la fiche : pas d'appel AJAX


async def test_extracts_every_chapter_listed_on_the_series_page() -> None:
    fetcher = FakeFetcher()
    fetcher.add(SERIES, fixture("mangas_origines_series.html"))

    chapters = (await MangasOriginesExtractor(fetcher).scrape_series(SERIES)).chapters

    # Lignes masquées (`en-trop`) comprises ; la ligne sans lien (chapitre à venir) est ignorée.
    assert [(c.number, c.title) for c in chapters] == [(12.5, "Interlude"), (12.0, None), (0.0, None)]
    assert [str(c.url) for c in chapters][1] == "https://mangas-origines.fr/oeuvre/lame-d-ombre/chapitre-12/"
    # Date complète lue dans `title` (le texte « 03/02/25 » n'a que deux chiffres pour l'année).
    assert chapters[0].published_at == datetime(2025, 2, 3, tzinfo=PARIS)
    assert all(c.language == "fr" for c in chapters)


def test_reads_the_information_list_not_the_leftover_madara_block() -> None:
    info = MangasOriginesExtractor(FakeFetcher()).parse_info_table(
        LexborHTMLParser(fixture("mangas_origines_series.html"))
    )

    assert info == {"année": "2024", "statut": "En cours", "type": "Manhwa", "scénario": "Auteur X"}


async def test_walks_the_catalog_until_wordpress_answers_404() -> None:
    fetcher = FakeFetcher()
    fetcher.add(CATALOG, fixture("mangas_origines_catalog.html"))
    # Pas de page 2 enregistrée : le faux fetcher répond 404, comme le site après la dernière page.

    urls = [url async for url in MangasOriginesExtractor(fetcher).discover()]

    assert urls == [SERIES, "https://mangas-origines.fr/oeuvre/le-dernier-archiviste/"]
    assert [call.url for call in fetcher.calls] == [CATALOG, CATALOG_2]


async def test_a_404_on_the_first_catalog_page_is_a_real_error() -> None:
    with pytest.raises(FetchError):
        _ = [url async for url in MangasOriginesExtractor(FakeFetcher()).discover()]
