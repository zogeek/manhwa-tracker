"""Orchestration d'un run : catalogue → fiches → lots vers l'API, avec télémétrie (`scrape_runs`, `source_health`).

Une fiche qui échoue n'arrête pas le run (il finit `partial`) ; un blocage anti-bot, si : insister
ne ferait qu'aggraver le bannissement, on s'arrête et on signale la source `blocked`.
"""

import logging
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from uuid import UUID

from pydantic import ValidationError

from .extractors import ExtractionError, SourceExtractor
from .fetching import BlockedByAntiBotError, FetchError
from .ingest_client import IngestClient, IngestError
from .models import HealthSample, HealthStatus, IngestBatch, RunOutcome, ScrapedManhwa

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RunStats:
    series_found: int = 0
    series_scraped: int = 0
    series_failed: int = 0
    chapters_sent: int = 0
    batches_sent: int = 0


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
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._extractor = extractor
        self._ingest = ingest
        self._source_id = source_id
        self._worker_version = worker_version
        self._batch_size = batch_size
        self._max_series = max_series
        self._now = now

    async def run(self) -> RunReport:
        run = await self._ingest.start_run(self._source_id, self._worker_version)
        stats = RunStats()
        try:
            await self._scrape(run.id, stats)
        except BlockedByAntiBotError as error:
            report = RunReport(run.id, "failed", stats, str(error))
            await self._close(report, "blocked", http_status=error.status, blocked_by=error.blocked_by)
            return report
        except Exception as error:
            await self._close(RunReport(run.id, "failed", stats, f"{type(error).__name__}: {error}"), "down")
            raise

        report = _conclude(run.id, stats)
        await self._close(report, "up" if report.outcome == "succeeded" else "degraded")
        return report

    async def _scrape(self, run_id: UUID, stats: RunStats) -> None:
        pending: list[ScrapedManhwa] = []
        async for url in self._extractor.discover():
            if self._max_series is not None and stats.series_found >= self._max_series:
                break
            stats.series_found += 1
            try:
                pending.append(await self._extractor.scrape_series(url))
                stats.series_scraped += 1
            except BlockedByAntiBotError:
                raise
            except (FetchError, ExtractionError, ValidationError) as error:
                stats.series_failed += 1
                logger.warning("Fiche ignorée %s : %s", url, error)
            if len(pending) >= self._batch_size:
                await self._flush(run_id, pending, stats)
        if pending:
            await self._flush(run_id, pending, stats)

    async def _flush(self, run_id: UUID, pending: list[ScrapedManhwa], stats: RunStats) -> None:
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


def _conclude(run_id: UUID, stats: RunStats) -> RunReport:
    if stats.series_found == 0:
        # Un catalogue vide est presque toujours un sélecteur cassé (refonte du site), pas un site vide.
        return RunReport(run_id, "failed", stats, "Catalogue vide : sélecteurs à vérifier")
    if stats.series_failed == 0:
        return RunReport(run_id, "succeeded", stats)
    if stats.series_scraped == 0:
        return RunReport(run_id, "failed", stats, "Aucune fiche n'a pu être extraite")
    return RunReport(run_id, "partial", stats)
