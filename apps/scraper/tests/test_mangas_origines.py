"""Premier extracteur « prêt » : fiche, chapitres et catalogue sur des fixtures synthétiques reproduisant le thème."""

import json
import re
from datetime import datetime
from urllib.parse import urlsplit

import pytest
from selectolax.lexbor import LexborHTMLParser

from manhwa_scraper.contract import ManhwaStatus, ManhwaType
from manhwa_scraper.extractors import ExtractionError, SeriesLink
from manhwa_scraper.extractors.parsing import PARIS
from manhwa_scraper.extractors.sites import default_registry
from manhwa_scraper.extractors.sites.mangas_origines import MangasOriginesExtractor, parse_search_response
from manhwa_scraper.fetching import FetchError

from .fakes import FakeFetcher, fixture

SERIES = "https://mangas-origines.fr/oeuvre/lame-d-ombre/"
CATALOG = "https://mangas-origines.fr/oeuvre/"
CATALOG_2 = "https://mangas-origines.fr/oeuvre/page/2/"
# `Disallow` de https://mangas-origines.fr/robots.txt pour `User-Agent: *` (relevé du 2026-10-06).
ROBOTS_DISALLOW = (
    "/wp-admin/",
    "/wp-content/cache/",
    "/wp-content/uploads/private/",
    "/cgi-bin/",
    "/trackback/",
    "/xmlrpc.php",
    "/?s=",
    "/*?s=",
    "/*?m_orderby=",
    "/*?replytocom=",
)
# `Allow` du même groupe : plus spécifique que `/wp-admin/`, il l'emporte (RFC 9309, règle la plus longue).
ROBOTS_ALLOW = ("/wp-admin/admin-ajax.php",)
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


def _robots_disallows(url: str) -> bool:
    """Correspondance RFC 9309 : préfixe du chemin + requête, `*` = n'importe quelle suite, `$` = fin.

    La règle la plus longue qui correspond décide ; à égalité, `Allow` l'emporte.
    """
    parts = urlsplit(url)
    target = parts.path + (f"?{parts.query}" if parts.query else "")

    def longest(rules: tuple[str, ...]) -> int:
        lengths = [-1]
        for rule in rules:
            pattern = re.escape(rule).replace(r"\*", ".*").removesuffix(r"\$")
            if re.match(pattern + ("$" if rule.endswith("$") else ""), target):
                lengths.append(len(rule))
        return max(lengths)

    return longest(ROBOTS_DISALLOW) > longest(ROBOTS_ALLOW)


def test_robots_rule_matcher_catches_the_former_catalog_url() -> None:
    assert _robots_disallows("https://mangas-origines.fr/oeuvre/page/2/?m_orderby=latest")


@pytest.mark.parametrize("page", [1, 2, 50])
def test_catalog_urls_respect_robots_txt(page: int) -> None:
    url = MangasOriginesExtractor(FakeFetcher()).catalog_page_url(page)

    assert not _robots_disallows(url), url


def test_the_ajax_endpoint_is_explicitly_allowed_unlike_the_rest_of_wp_admin() -> None:
    assert _robots_disallows("https://mangas-origines.fr/wp-admin/options.php")
    assert not _robots_disallows(AJAX)


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
