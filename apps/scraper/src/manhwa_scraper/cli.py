"""Point d'entrée et composition root : seul module qui instancie les implémentations concrètes.

manhwa-scraper                         # liste les sources connues (défaut)
manhwa-scraper run <slug> --source-id <uuid> [--max-series N]   # découverte : dernières sorties du catalogue
manhwa-scraper track <url>... --source-id <uuid>                 # séries suivies : ces fiches seulement
manhwa-scraper search <slug> "<titre>"                           # URL de la fiche, via Brave Search
"""

import argparse
import asyncio
import logging
import sys
from collections.abc import Sequence
from contextlib import AsyncExitStack
from uuid import UUID

from pydantic import ValidationError

from . import __version__
from .config import Settings, load_search_settings, load_settings
from .contract import RunOutcome
from .extractors import SourceExtractor, UnknownSourceError
from .extractors.sites import default_registry
from .fetching import ThrottledFetcher, TieredFetcher
from .fetching.browser import CamoufoxFetcher
from .fetching.http import CurlCffiFetcher
from .ingest_client import IngestClient, create_http_client
from .pipeline import RunReport, ScrapeRunner
from .search import BraveSearchEngine, SearchError, SeriesFinder, create_brave_client


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="manhwa-scraper", description="Worker de scraping → API /api/ingest")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("sources", help="liste les sources connues et leur état (défaut)")
    run = commands.add_parser("run", help="scrape une source et pousse les données vers l'API")
    run.add_argument("slug", help="slug de la source (voir `sources`)")
    run.add_argument("--source-id", type=UUID, required=True, help="UUID de la source dans l'API (table `sources`)")
    run.add_argument("--max-series", type=int, default=None, help="limite le nombre de fiches (essais)")
    track = commands.add_parser("track", help="scrape les fiches données (séries suivies) et les pousse vers l'API")
    track.add_argument("urls", nargs="+", metavar="url", help="URL de fiche, toutes de la même source")
    track.add_argument("--source-id", type=UUID, required=True, help="UUID de la source dans l'API (table `sources`)")
    search = commands.add_parser("search", help="trouve l'URL de la fiche d'une œuvre (dorking via Brave Search)")
    search.add_argument("slug", help="slug de la source (voir `sources`)")
    search.add_argument("title", help="titre de l'œuvre, tel qu'affiché sur le site")
    return parser


def _print_sources() -> None:
    for extractor in default_registry().all():
        state = "prêt" if extractor.ready else "squelette"
        print(f"{extractor.slug:<18} {state:<10} {extractor.base_url}")


async def _run(
    settings: Settings,
    extractor_cls: type[SourceExtractor],
    source_id: UUID,
    *,
    max_series: int | None = None,
    urls: Sequence[str] | None = None,
) -> RunReport:
    async with AsyncExitStack() as stack:
        http_fetcher = await stack.enter_async_context(CurlCffiFetcher(timeout_s=settings.page_timeout_ms / 1000))
        browser_fetcher = await stack.enter_async_context(
            CamoufoxFetcher(headless=settings.headless, timeout_ms=settings.page_timeout_ms)
        )
        fetcher = ThrottledFetcher(
            TieredFetcher(http_fetcher, browser_fetcher), min_interval_s=settings.request_interval_s
        )
        api = await stack.enter_async_context(
            create_http_client(str(settings.api_url), settings.api_key.get_secret_value())
        )
        runner = ScrapeRunner(
            extractor_cls(fetcher),
            IngestClient(api),
            source_id=source_id,
            worker_version=__version__,
            batch_size=settings.batch_size,
            max_series=max_series,
            urls=urls,
        )
        return await runner.run()


async def _search(api_key: str, extractor_cls: type[SourceExtractor], title: str) -> str | None:
    async with create_brave_client(api_key) as http:
        return await SeriesFinder(BraveSearchEngine(http)).find(extractor_cls, title)


def _ready_extractor(slug: str | None, urls: Sequence[str]) -> type[SourceExtractor]:
    """Extracteur désigné par `slug`, ou commun à toutes les `urls` (un run = une source)."""
    registry = default_registry()
    if slug is not None:
        extractor_cls = registry.get(slug)
    else:
        extractors = {registry.for_url(url) for url in urls}
        if len(extractors) > 1:
            raise UnknownSourceError("Les URL suivies doivent toutes appartenir à la même source (un run par source)")
        (extractor_cls,) = extractors
    if not extractor_cls.ready:
        raise UnknownSourceError(f"La source « {extractor_cls.slug} » n'est encore qu'un squelette (ready = False)")
    return extractor_cls


def _main_search(slug: str, title: str) -> int:
    try:
        extractor_cls = default_registry().get(slug)
        api_key = load_search_settings().brave_search_api_key.get_secret_value()
        url = asyncio.run(_search(api_key, extractor_cls, title))
    except (UnknownSourceError, ValidationError, ValueError, SearchError) as error:
        print(error, file=sys.stderr)
        return 2
    if url is None:
        print(f"Aucune fiche {slug} trouvée pour « {title} »", file=sys.stderr)
        return 1
    print(url)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command in (None, "sources"):
        _print_sources()
        return 0
    if args.command == "search":
        return _main_search(args.slug, args.title)

    urls: list[str] | None = args.urls if args.command == "track" else None
    try:
        extractor_cls = _ready_extractor(args.slug if urls is None else None, urls or [])
        settings = load_settings()
    except (UnknownSourceError, ValidationError) as error:
        print(error, file=sys.stderr)
        return 2

    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
    if urls is not None:
        # Un lien de chapitre collé par erreur ramène à sa fiche ; une URL non reconnue est gardée telle quelle.
        urls = [extractor_cls.series_url(url) or url for url in urls]
    max_series: int | None = args.max_series if urls is None else None
    report = asyncio.run(_run(settings, extractor_cls, args.source_id, max_series=max_series, urls=urls))
    logging.getLogger(__name__).info("Run %s terminé : %s %s", report.run_id, report.outcome, report.stats)
    return 0 if report.outcome is not RunOutcome.failed else 1
