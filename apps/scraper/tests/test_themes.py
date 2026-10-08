from datetime import datetime
from typing import ClassVar

import pytest
from selectolax.lexbor import LexborHTMLParser

from manhwa_scraper.extractors import ExtractionError
from manhwa_scraper.extractors.parsing import PARIS
from manhwa_scraper.extractors.themes import MadaraExtractor, MangaThemesiaExtractor

from .fakes import FakeFetcher, fixture


class DemoMadara(MadaraExtractor):
    slug: ClassVar[str] = "demo-madara"
    name: ClassVar[str] = "Démo Madara"
    base_url: ClassVar[str] = "https://scan.test/"


class DemoThemesia(MangaThemesiaExtractor):
    slug: ClassVar[str] = "demo-themesia"
    name: ClassVar[str] = "Démo MangaThemesia"
    base_url: ClassVar[str] = "https://scan.test/"


NECRO = "https://scan.test/manga/necro/"
SOLO = "https://scan.test/manga/solo/"


class TestMadara:
    async def test_scrapes_series_with_chapters_listed_on_the_page(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(NECRO, fixture("madara_series.html"))

        manhwa = await DemoMadara(fetcher).scrape_series(NECRO)

        assert manhwa.title == "Le Nécromancien Catastrophique"
        assert (
            str(manhwa.cover_url) == "https://scan.test/wp-content/uploads/cover.webp"
        )  # data-src, pas le placeholder
        assert manhwa.synopsis == "Un nécromancien revient."
        assert (manhwa.type, manhwa.status) == ("manhwa", "ongoing")
        # « Annonce » n'a pas de numéro : ignorée plutôt que de faire échouer toute la fiche.
        assert [(c.number, c.title) for c in manhwa.chapters] == [(12.5, "Le retour"), (12.0, None)]
        assert str(manhwa.chapters[1].url) == "https://scan.test/manga/necro/chapitre-12/"
        assert manhwa.chapters[1].published_at == datetime(2025, 1, 12, tzinfo=PARIS)
        assert manhwa.chapters[0].published_at is not None  # « il y a 3 heures » lu dans le badge NEW
        assert len(fetcher.calls) == 1  # pas d'appel AJAX inutile

    async def test_falls_back_to_the_ajax_chapter_endpoint(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(SOLO, fixture("madara_series_ajax.html"))
        fetcher.add(f"{SOLO}ajax/chapters/", fixture("madara_chapters_fragment.html"), method="POST")

        manhwa = await DemoMadara(fetcher).scrape_series(SOLO)

        assert [c.number for c in manhwa.chapters] == [2.0, 1.0]
        ajax_call = fetcher.calls[1]
        assert ajax_call.method == "POST"
        assert ajax_call.headers is not None
        assert ajax_call.headers["X-Requested-With"] == "XMLHttpRequest"

    def test_missing_title_is_an_extraction_error(self) -> None:
        with pytest.raises(ExtractionError, match="Titre introuvable"):
            DemoMadara(FakeFetcher()).parse_series(LexborHTMLParser("<html><body></body></html>"), NECRO)

    async def test_discover_walks_catalog_pages_until_empty_and_dedupes(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add("https://scan.test/manga/?m_orderby=latest", fixture("madara_catalog.html"))
        fetcher.add("https://scan.test/manga/page/2/?m_orderby=latest", fixture("madara_catalog.html"))
        fetcher.add("https://scan.test/manga/page/3/?m_orderby=latest", "<html><body></body></html>")

        urls = [url async for url in DemoMadara(fetcher).discover()]

        # La page 2 ne renvoie que des fiches déjà vues : le parcours s'arrête là, sans demander la page 3.
        assert urls == [NECRO, SOLO]
        assert len(fetcher.calls) == 2

    async def test_discover_stops_when_the_next_catalog_page_is_a_404(self) -> None:
        fetcher = FakeFetcher()  # page 2 absente → 404, comme WordPress après la dernière page
        fetcher.add("https://scan.test/manga/?m_orderby=latest", fixture("madara_catalog.html"))

        urls = [url async for url in DemoMadara(fetcher).discover()]

        assert urls == [NECRO, SOLO]


class TestMangaThemesia:
    async def test_scrapes_series(self) -> None:
        url = "https://scan.test/manga/omniscient/"
        fetcher = FakeFetcher()
        fetcher.add(url, fixture("mangathemesia_series.html"))

        manhwa = await DemoThemesia(fetcher).scrape_series(url)

        assert manhwa.title == "Omniscient Reader"
        assert (manhwa.type, manhwa.status) == ("manhwa", "completed")
        assert manhwa.synopsis == "La fin du monde."
        assert [c.number for c in manhwa.chapters] == [551.0, 550.0]
        assert str(manhwa.chapters[1].url) == "https://scan.test/omniscient-chapitre-550/"
        assert manhwa.chapters[0].published_at == datetime(2025, 2, 3, tzinfo=PARIS)

    def test_catalog_url(self) -> None:
        assert DemoThemesia(FakeFetcher()).catalog_page_url(2) == "https://scan.test/manga/?page=2&order=update"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://scan.test/manga/solo/", "https://scan.test/manga/solo/"),
        ("https://www.scan.test/manga/solo", "https://scan.test/manga/solo/"),
        ("https://scan.test/manga/solo/chapitre-12/?style=list", "https://scan.test/manga/solo/"),
        ("https://scan.test/manga/", None),
        ("https://scan.test/manga/page/2/", None),
        ("https://scan.test/genre/action/", None),
        ("https://ailleurs.test/manga/solo/", None),
    ],
)
def test_madara_recognises_series_urls(url: str, expected: str | None) -> None:
    assert DemoMadara.series_url(url) == expected


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://scan.test/manga/omniscient/", "https://scan.test/manga/omniscient/"),
        ("https://scan.test/omniscient-chapitre-550/", None),
        ("https://scan.test/manga/", None),
    ],
)
def test_mangathemesia_recognises_series_urls(url: str, expected: str | None) -> None:
    assert DemoThemesia.series_url(url) == expected
