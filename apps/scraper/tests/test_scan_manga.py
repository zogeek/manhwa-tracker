"""scan-manga.com : découverte par l'accueil (dernières sorties ou Top), romans et tomes licenciés écartés."""

import pytest
from selectolax.lexbor import LexborHTMLParser

from manhwa_scraper.contract import ManhwaStatus, ManhwaType
from manhwa_scraper.extractors import ExtractionError, UnsupportedDiscoveryError, UnsupportedSeriesError
from manhwa_scraper.extractors.sites import default_registry
from manhwa_scraper.extractors.sites.scan_manga import ScanMangaExtractor

from .fakes import FakeFetcher, fixture

HOME = "https://www.scan-manga.com/"
SERIES = "https://www.scan-manga.com/17231/La-Tour-Sans-Fin.html"


def test_is_ready_and_resolves_urls_with_or_without_www() -> None:
    assert ScanMangaExtractor.ready
    assert default_registry().for_url("https://scan-manga.com/1805/Le-Royaume.html") is ScanMangaExtractor


async def test_has_no_native_search_because_the_site_reserves_it_to_browsers() -> None:
    # `qsearch.json` et `bqj…/search/quick.json` : 200 au corps vide pour un client HTTP (refus ciblé, cf. module).
    fetcher = FakeFetcher()

    with pytest.raises(UnsupportedDiscoveryError):
        await ScanMangaExtractor(fetcher).search_series("Le Royaume")

    assert fetcher.calls == []  # aucune requête au site : `SeriesFinder` retombe sur le dorking


async def test_discovers_series_from_the_latest_releases_only() -> None:
    fetcher = FakeFetcher()
    fetcher.add(HOME, fixture("scan_manga_home.html"))

    urls = [url async for url in ScanMangaExtractor(fetcher).discover()]

    # Dédoublonnées, dans l'ordre de sortie ; le « Top » du pied de page n'est pas une nouveauté.
    assert urls == [SERIES, "https://www.scan-manga.com/1805-54398/Le-Royaume.html"]
    assert [call.url for call in fetcher.calls] == [HOME]  # une seule page rendue côté serveur


async def test_scrapes_a_series_page() -> None:
    fetcher = FakeFetcher()
    fetcher.add(SERIES, fixture("scan_manga_series.html"))

    manhwa = await ScanMangaExtractor(fetcher).scrape_series(SERIES)

    assert manhwa.title == "La Tour Sans Fin"
    assert (manhwa.type, manhwa.status) == (ManhwaType.manhwa, ManhwaStatus.ongoing)
    assert manhwa.synopsis == "Un grimpeur gravit une tour sans sommet."
    assert str(manhwa.cover_url) == "https://static.scan-manga.com/img/manga/La_Tour_Sans_Fin_1_42.jpg"


async def test_keeps_only_readable_numbered_chapters() -> None:
    fetcher = FakeFetcher()
    fetcher.add(SERIES, fixture("scan_manga_series.html"))

    chapters = (await ScanMangaExtractor(fetcher).scrape_series(SERIES)).chapters

    # « Chapitre Extra » n'a pas de numéro ; le chapitre 1 appartient à un tome paru en France (pas de lien).
    assert [(c.number, c.title) for c in chapters] == [(13.0, "Le sommet"), (12.5, None)]
    assert (
        str(chapters[1].url) == "https://www.scan-manga.com/lecture-en-ligne/La-Tour-Sans-Fin-Chapitre-12-5-FR_2.html"
    )


def test_reads_the_parallel_technical_sheet() -> None:
    info = ScanMangaExtractor(FakeFetcher()).parse_info_table(LexborHTMLParser(fixture("scan_manga_series.html")))

    assert info["statut"] == "En cours"
    assert info["catégorie"] == "Manhwa Shonen"
    assert info["team"] == "Team Test"


async def test_novels_are_out_of_scope() -> None:
    fetcher = FakeFetcher()
    fetcher.add(SERIES, fixture("scan_manga_novel.html"))

    with pytest.raises(UnsupportedSeriesError, match="Novel"):
        await ScanMangaExtractor(fetcher).scrape_series(SERIES)


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (
            "https://scan-manga.com/1805-54398/Le-Royaume.html?x=1",
            "https://www.scan-manga.com/1805-54398/Le-Royaume.html",
        ),
        (SERIES, SERIES),
        ("https://www.scan-manga.com/", None),
        ("https://www.scan-manga.com/lecture-en-ligne/Le-Royaume-Chapitre-12-FR_123.html", None),
        ("https://ailleurs.test/1805/Le-Royaume.html", None),
    ],
)
def test_recognises_series_urls(url: str, expected: str | None) -> None:
    assert ScanMangaExtractor.series_url(url) == expected


def test_reads_the_top_ranking_of_the_right_column_only() -> None:
    links = ScanMangaExtractor(FakeFetcher()).parse_top(LexborHTMLParser(fixture("scan_manga_home.html")), HOME)

    # Classement BD uniquement (le Top novels est hors périmètre), liens relatifs résolus, dans l'ordre du rang.
    assert [(link.title, link.url) for link in links] == [
        ("Populaire Mais Pas Nouveau", "https://www.scan-manga.com/999/Populaire-Mais-Pas-Nouveau.html"),
        ("Le Royaume", "https://www.scan-manga.com/1805-54398/Le-Royaume.html"),
        ("Populaire Mais Pas Nouveau", "https://www.scan-manga.com/999/Populaire-Mais-Pas-Nouveau.html"),
    ]


async def test_discovers_the_top_in_a_single_request() -> None:
    fetcher = FakeFetcher()
    fetcher.add(HOME, fixture("scan_manga_home.html"))

    urls = [url async for url in ScanMangaExtractor(fetcher).discover_top()]

    assert urls == [
        "https://www.scan-manga.com/999/Populaire-Mais-Pas-Nouveau.html",
        "https://www.scan-manga.com/1805-54398/Le-Royaume.html",
    ]
    assert [call.url for call in fetcher.calls] == [HOME]


async def test_a_missing_top_block_is_an_extraction_error() -> None:
    fetcher = FakeFetcher()
    fetcher.add(HOME, "<html><body><div id='right_fixed'></div></body></html>")

    with pytest.raises(ExtractionError, match="Top"):
        [url async for url in ScanMangaExtractor(fetcher).discover_top()]
