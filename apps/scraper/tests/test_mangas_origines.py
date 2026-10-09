"""Premier extracteur « prêt » : fiche, chapitres et catalogue sur des fixtures synthétiques reproduisant le thème."""

import json
from datetime import datetime

import pytest
from selectolax.lexbor import LexborHTMLParser

from manhwa_scraper.contract import ManhwaStatus, ManhwaType
from manhwa_scraper.extractors import ExtractionError, SeriesLink
from manhwa_scraper.extractors.parsing import PARIS
from manhwa_scraper.extractors.sites import default_registry
from manhwa_scraper.extractors.sites.mangas_origines import MangasOriginesExtractor, parse_search_response
from manhwa_scraper.fetching import FetchError, RobotsGuardedFetcher, RobotsPolicy

from .fakes import FakeFetcher, fixture

SERIES = "https://mangas-origines.fr/oeuvre/lame-d-ombre/"
CATALOG = "https://mangas-origines.fr/oeuvre/"
CATALOG_2 = "https://mangas-origines.fr/oeuvre/page/2/"
ROBOTS = "https://mangas-origines.fr/robots.txt"
ORDERED = "https://mangas-origines.fr/oeuvre/?m_orderby=latest"
AJAX = "https://mangas-origines.fr/wp-admin/admin-ajax.php"


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


async def test_a_404_on_the_first_catalog_page_is_a_real_error() -> None:
    with pytest.raises(FetchError):
        _ = [url async for url in MangasOriginesExtractor(FakeFetcher()).discover()]


async def test_walks_the_catalog_in_default_order_until_wordpress_answers_404() -> None:
    """`robots_mangas_origines.txt` = copie du fichier du site (relevé du 2026-10-09), qui interdit `/*?m_orderby=`."""
    fetcher = FakeFetcher()
    fetcher.add(ROBOTS, fixture("robots_mangas_origines.txt"))
    fetcher.add(CATALOG, fixture("mangas_origines_catalog.html"))
    # Pas de page 2 enregistrée : le faux fetcher répond 404, comme le site après la dernière page.
    guarded = RobotsGuardedFetcher(fetcher, RobotsPolicy(fetcher))

    urls = [url async for url in MangasOriginesExtractor(guarded).discover()]

    assert urls == [SERIES, "https://mangas-origines.fr/oeuvre/le-dernier-archiviste/"]
    # La variante triée n'est jamais demandée au site : seul le robots.txt l'a été, une fois.
    assert [call.url for call in fetcher.calls] == [ROBOTS, CATALOG, CATALOG_2]


async def test_the_series_and_admin_ajax_stay_allowed() -> None:
    fetcher = FakeFetcher()
    fetcher.add(ROBOTS, fixture("robots_mangas_origines.txt"))
    policy = RobotsPolicy(fetcher)

    assert await policy.allowed(SERIES)
    assert await policy.allowed(AJAX)
    assert not await policy.allowed(ORDERED)
    assert not await policy.allowed("https://mangas-origines.fr/?s=solo")


class TestNativeSearch:
    async def test_posts_the_child_theme_search_form_to_admin_ajax(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(AJAX, json.dumps({"success": True, "data": []}), method="POST")

        assert await MangasOriginesExtractor(fetcher).search_series("Lame d'ombre") == []

        (call,) = fetcher.calls
        assert (call.method, call.url) == ("POST", AJAX)
        assert call.data == {"action": "madara_child_search", "term": "Lame d'ombre"}
        assert call.headers is not None
        assert call.headers["Content-Type"] == "application/x-www-form-urlencoded"
        assert call.headers["X-Requested-With"] == "XMLHttpRequest"

    def test_reads_title_and_url_in_site_order_and_decodes_entities(self) -> None:
        body = json.dumps(
            {
                "success": True,
                "data": [
                    {
                        "title": "L&#8217;ascension",
                        "url": "https://mangas-origines.fr/oeuvre/l-ascension/",
                        "thumb": "https://mangas-origines.fr/wp-content/uploads/a-150x150.png",
                        "genres": "Action · Aventure",
                        "rating": "4.3",
                    },
                    {"title": "Lame d'ombre", "url": SERIES},
                ],
            }
        )

        assert parse_search_response(body) == [
            SeriesLink(title="L’ascension", url="https://mangas-origines.fr/oeuvre/l-ascension/"),
            SeriesLink(title="Lame d'ombre", url=SERIES),
        ]

    def test_a_refusal_means_no_result(self) -> None:
        body = json.dumps({"success": False, "data": [{"error": "not found", "message": "No Posts Found"}]})

        assert parse_search_response(body) == []

    @pytest.mark.parametrize(
        "body",
        [
            "<html>maintenance</html>",
            '{"data": []}',
            '{"success": true, "data": [{"title": "sans url"}]}',
        ],
    )
    def test_an_unexpected_answer_is_an_extraction_error(self, body: str) -> None:
        with pytest.raises(ExtractionError, match="inattendue"):
            parse_search_response(body)
