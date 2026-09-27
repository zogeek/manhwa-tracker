"""Point d'entrée et composition root : seul module qui instancie les implémentations concrètes.

manhwa-scraper                         # liste les sources connues (défaut)
manhwa-scraper run <slug> --source-id <uuid> [--max-series N]
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
from .config import Settings, load_settings
from .contract import RunOutcome
from .extractors import SourceExtractor, UnknownSourceError
from .extractors.sites import default_registry
from .fetching import ThrottledFetcher, TieredFetcher
from .fetching.browser import CamoufoxFetcher
from .fetching.http import CurlCffiFetcher
from .ingest_client import IngestClient, create_http_client
from .pipeline import RunReport, ScrapeRunner


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="manhwa-scraper", description="Worker de scraping → API /api/ingest")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("sources", help="liste les sources connues et leur état (défaut)")
    run = commands.add_parser("run", help="scrape une source et pousse les données vers l'API")
    run.add_argument("slug", help="slug de la source (voir `sources`)")
    run.add_argument("--source-id", type=UUID, required=True, help="UUID de la source dans l'API (table `sources`)")
    run.add_argument("--max-series", type=int, default=None, help="limite le nombre de fiches (essais)")
    return parser


def _print_sources() -> None:
    for extractor in default_registry().all():
        state = "prêt" if extractor.ready else "squelette"
        print(f"{extractor.slug:<18} {state:<10} {extractor.base_url}")


async def _run(
    settings: Settings, extractor_cls: type[SourceExtractor], source_id: UUID, max_series: int | None
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
        )
        return await runner.run()


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command in (None, "sources"):
        _print_sources()
        return 0

    try:
        extractor_cls = default_registry().get(args.slug)
        if not extractor_cls.ready:
            raise UnknownSourceError(f"La source « {args.slug} » n'est encore qu'un squelette (ready = False)")
        settings = load_settings()
    except (UnknownSourceError, ValidationError) as error:
        print(error, file=sys.stderr)
        return 2

    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
    report = asyncio.run(_run(settings, extractor_cls, args.source_id, args.max_series))
    logging.getLogger(__name__).info("Run %s terminé : %s %s", report.run_id, report.outcome, report.stats)
    return 0 if report.outcome is not RunOutcome.failed else 1
