"""Orchestration d'un run : cibles → fiches → lots vers l'API, avec télémétrie (`scrape_runs`, `source_health`).

Les cibles viennent par défaut du catalogue de la source (`discover`, dernières sorties) ; on peut en fournir
d'autres : le « Top » du site (`discover_top`), une liste d'URLs explicites (`explicit_urls`) ou les séries
suivies lues dans l'API (`ScrapeTarget` : l'URL et la fiche de l'API à laquelle la rattacher).

Une fiche qui échoue n'arrête pas le run (il finit `partial`) ; un blocage anti-bot, si : insister
ne ferait qu'aggraver le bannissement, on s'arrête et on signale la source `blocked`.
"""

import logging
from collections.abc import AsyncIterable, AsyncIterator, Callable, Iterable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from uuid import UUID

from pydantic import ValidationError

from .contract import HealthSample, HealthStatus, IngestBatch, IngestManhwa, RunOutcome
from .extractors import ExtractionError, SourceExtractor, UnsupportedSeriesError
from .fetching import BlockedByAntiBotError, DisallowedByRobotsError, FetchError
from .ingest_client import IngestClient, IngestError

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RunStats:
    series_found: int = 0
    series_scraped: int = 0
    series_failed: int = 0
    series_skipped: int = 0
    chapters_sent: int = 0
    batches_sent: int = 0


@dataclass(frozen=True, slots=True)
class ScrapeTarget:
    url: str
    manhwa_id: UUID | None = None
    """Fiche de l'API à laquelle rattacher la page : sans elle, une URL encore inconnue créerait un doublon."""


@dataclass(frozen=True, slots=True)
class RunReport:
    run_id: UUID
    outcome: RunOutcome
    stats: RunStats
    error: str | None = None


class ScrapeRunner:
    def __init__(
        self,
        extractor: SourceExtractor,
        ingest: IngestClient,
        *,
        source_id: UUID,
        worker_version: str,
        batch_size: int = 20,
        max_series: int | None = None,
        targets: AsyncIterable[str | ScrapeTarget] | None = None,
        allow_empty: bool = False,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._extractor = extractor
        self._ingest = ingest
        self._source_id = source_id
        self._worker_version = worker_version
        self._batch_size = batch_size
        self._max_series = max_series
        self._targets: AsyncIterable[str | ScrapeTarget] = targets if targets is not None else extractor.discover()
        # Un catalogue vide trahit un sélecteur cassé ; une liste de suivi vide est, elle, normale.
        self._allow_empty = allow_empty
        self._now = now

    async def run(self) -> RunReport:
        run = await self._ingest.start_run(self._source_id, self._worker_version)
        stats = RunStats()
        try:
            await self._scrape(run.id, stats)
        except BlockedByAntiBotError as error:
            report = RunReport(run.id, RunOutcome.failed, stats, str(error))
            await self._close(report, HealthStatus.blocked, http_status=error.status, blocked_by=error.blocked_by)
            return report
        except Exception as error:
            await self._close(
                RunReport(run.id, RunOutcome.failed, stats, f"{type(error).__name__}: {error}"), HealthStatus.down
            )
            raise

        report = _conclude(run.id, stats, allow_empty=self._allow_empty)
        await self._close(report, HealthStatus.up if report.outcome is RunOutcome.succeeded else HealthStatus.degraded)
        return report

    async def _scrape(self, run_id: UUID, stats: RunStats) -> None:
        pending: list[IngestManhwa] = []
        async for target in self._targets:
            if self._max_series is not None and stats.series_found >= self._max_series:
                break
            url, manhwa_id = (target, None) if isinstance(target, str) else (target.url, target.manhwa_id)
            stats.series_found += 1
            try:
                manhwa = await self._extractor.scrape_series(url)
                pending.append(manhwa if manhwa_id is None else manhwa.model_copy(update={"manhwa_id": manhwa_id}))
                stats.series_scraped += 1
            except BlockedByAntiBotError:
                raise
            except DisallowedByRobotsError as error:
                # Choix du site, pas une panne : la fiche est écartée sans dégrader le run.
                stats.series_skipped += 1
                logger.info("Fiche écartée : %s", error)
            except UnsupportedSeriesError as error:
                stats.series_skipped += 1
                logger.info("Fiche hors périmètre ignorée %s : %s", url, error)
            except (FetchError, ExtractionError, ValidationError) as error:
                stats.series_failed += 1
                logger.warning("Fiche ignorée %s : %s", url, error)
            if len(pending) >= self._batch_size:
                await self._flush(run_id, pending, stats)
        if pending:
            await self._flush(run_id, pending, stats)

    async def _flush(self, run_id: UUID, pending: list[IngestManhwa], stats: RunStats) -> None:
        batch = IngestBatch(source_id=self._source_id, scrape_run_id=run_id, manhwas=pending)
        # Clé déterministe : si le worker plante puis rejoue ce lot, l'API reconnaît un lot déjà traité.
        result = await self._ingest.send_batch(batch, idempotency_key=f"{run_id}:{stats.batches_sent}")
        stats.batches_sent += 1
        stats.chapters_sent += sum(len(manhwa.chapters) for manhwa in pending)
        logger.info(
            "Lot %d envoyé : %d œuvres, %d chapitres créés", stats.batches_sent, len(pending), result.chapters_created
        )
        pending.clear()

    async def _close(
        self,
        report: RunReport,
        health: HealthStatus,
        *,
        http_status: int | None = None,
        blocked_by: str | None = None,
    ) -> None:
        await self._ingest.finish_run(report.run_id, report.outcome, stats=asdict(report.stats), error=report.error)
        sample = HealthSample(
            source_id=self._source_id,
            scrape_run_id=report.run_id,
            status=health,
            http_status=http_status,
            blocked_by=blocked_by,
            checked_at=self._now(),
        )
        try:
            await self._ingest.record_health([sample])
        except IngestError as error:
            # Le run est déjà clos : une télémétrie perdue ne doit pas faire échouer le worker.
            logger.warning("Santé de la source non enregistrée : %s", error)


async def explicit_urls(urls: Iterable[str]) -> AsyncIterator[str]:
    """Cibles d'un run « URL directe » : les fiches données, sans doublon, sans passer par un catalogue."""
    for url in dict.fromkeys(urls):
        yield url


def _conclude(run_id: UUID, stats: RunStats, *, allow_empty: bool) -> RunReport:
    if stats.series_found == 0 and not allow_empty:
        # Un catalogue (ou un Top) vide est presque toujours un sélecteur cassé (refonte du site), pas un site vide.
        return RunReport(run_id, RunOutcome.failed, stats, "Catalogue vide : sélecteurs à vérifier")
    if stats.series_failed == 0:
        return RunReport(run_id, RunOutcome.succeeded, stats)
    if stats.series_scraped == 0:
        return RunReport(run_id, RunOutcome.failed, stats, "Aucune fiche n'a pu être extraite")
    return RunReport(run_id, RunOutcome.partial, stats)
