"""Point d'entrée et composition root : seul module qui instancie les implémentations concrètes.

manhwa-scraper                         # liste les sources connues (défaut)
manhwa-scraper run <slug> --source-id <uuid> [--discovery latest|top] [--max-series N]
manhwa-scraper track --source-id <uuid> [<url> ...] [--urls-file fichier.txt]
manhwa-scraper search <slug> "<titre>"   # URL de la fiche, par dorking sur un moteur de recherche
"""

import argparse
import asyncio
import logging
import sys
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import ValidationError

from . import __version__
from .config import Settings, load_search_settings, load_settings
from .contract import RunOutcome
from .extractors import SourceExtractor, UnknownSourceError, UnsupportedDiscoveryError
from .extractors.sites import default_registry
from .fetching import ThrottledFetcher, TieredFetcher
from .fetching.browser import CamoufoxFetcher
from .fetching.http import CurlCffiFetcher
from .ingest_client import IngestClient, create_http_client
from .pipeline import RunReport, ScrapeRunner, explicit_urls
from .search import BraveSearchEngine, SearchError, SeriesFinder, create_brave_client

Discovery = Literal["latest", "top"]
Targets = Callable[[SourceExtractor], AsyncIterator[str]]
"""Cibles d'un run, calculées une fois l'extracteur construit (il porte le fetcher)."""


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="manhwa-scraper", description="Worker de scraping → API /api/ingest")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("sources", help="liste les sources connues et leur état (défaut)")
    run = commands.add_parser("run", help="scrape une source et pousse les données vers l'API")
    run.add_argument("slug", help="slug de la source (voir `sources`)")
    run.add_argument("--source-id", type=UUID, required=True, help="UUID de la source dans l'API (table `sources`)")
    run.add_argument(
        "--discovery",
        choices=("latest", "top"),
        default="latest",
        help="latest : dernières sorties (défaut) ; top : œuvres du classement « Top » du site",
    )
    run.add_argument("--max-series", type=int, default=None, help="limite le nombre de fiches (essais)")
    track = commands.add_parser("track", help="scrape uniquement les fiches données (séries suivies), sans catalogue")
    track.add_argument("urls", nargs="*", metavar="url", help="URL de fiche ; la source est déduite du domaine")
    track.add_argument(
        "--urls-file", type=Path, default=None, help="fichier d'URLs, une par ligne (lignes vides et # ignorées)"
    )
    track.add_argument("--source-id", type=UUID, required=True, help="UUID de la source dans l'API (table `sources`)")
    track.add_argument("--max-series", type=int, default=None, help="limite le nombre de fiches (essais)")
    search = commands.add_parser("search", help="trouve l'URL de la fiche d'une œuvre (dorking sur un moteur tiers)")
    search.add_argument("slug", help="slug de la source (voir `sources`)")
    search.add_argument("title", help="titre de l'œuvre, tel qu'affiché sur le site")
    return parser


def _read_urls_file(path: Path) -> list[str]:
    lines = (line.strip() for line in path.read_text(encoding="utf-8").splitlines())
    return [line for line in lines if line and not line.startswith("#")]


def _discovery(mode: Discovery) -> Targets:
    if mode == "top":
        return lambda extractor: extractor.discover_top()
    return lambda extractor: extractor.discover()


def _tracked(urls: list[str]) -> Targets:
    return lambda _extractor: explicit_urls(urls)


def _resolve(args: argparse.Namespace) -> tuple[type[SourceExtractor], Targets]:
    """Extracteur et cibles du run demandé. Lève une `UnknownSourceError` / `UnsupportedDiscoveryError` sinon."""
    registry = default_registry()
    if args.command == "track":
        urls: list[str] = [*args.urls, *(_read_urls_file(args.urls_file) if args.urls_file else [])]
        extractor_cls = registry.for_urls(urls)
        # Un lien de chapitre ramène à sa fiche ; une URL que l'extracteur ne sait pas lire est gardée telle quelle.
        targets = _tracked([extractor_cls.series_url(url) or url for url in urls])
    else:
        extractor_cls = registry.get(args.slug)
        if args.discovery == "top" and extractor_cls.top_page_url is None:
            raise UnsupportedDiscoveryError(f"La source « {extractor_cls.slug} » n'expose pas de Top")
        targets = _discovery(args.discovery)
    if not extractor_cls.ready:
        raise UnknownSourceError(f"La source « {extractor_cls.slug} » n'est encore qu'un squelette (ready = False)")
    return extractor_cls, targets


async def _search(api_key: str, extractor_cls: type[SourceExtractor], title: str) -> str | None:
    async with create_brave_client(api_key) as http:
        return await SeriesFinder(BraveSearchEngine(http)).find(extractor_cls, title)


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


def _print_sources() -> None:
    for extractor in default_registry().all():
        state = "prêt" if extractor.ready else "squelette"
        print(f"{extractor.slug:<18} {state:<10} {extractor.base_url}")


async def _run(
    settings: Settings,
    extractor_cls: type[SourceExtractor],
    targets: Targets,
    source_id: UUID,
    max_series: int | None,
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
        extractor = extractor_cls(fetcher)
        runner = ScrapeRunner(
            extractor,
            IngestClient(api),
            source_id=source_id,
            worker_version=__version__,
            batch_size=settings.batch_size,
            max_series=max_series,
            targets=targets(extractor),
        )
        return await runner.run()


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command in (None, "sources"):
        _print_sources()
        return 0
    if args.command == "search":
        return _main_search(args.slug, args.title)

    try:
        extractor_cls, targets = _resolve(args)
        settings = load_settings()
    except (UnknownSourceError, UnsupportedDiscoveryError, ValidationError, OSError) as error:
        print(error, file=sys.stderr)
        return 2

    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
    report = asyncio.run(_run(settings, extractor_cls, targets, args.source_id, args.max_series))
    logging.getLogger(__name__).info("Run %s terminé : %s %s", report.run_id, report.outcome, report.stats)
    return 0 if report.outcome is not RunOutcome.failed else 1
