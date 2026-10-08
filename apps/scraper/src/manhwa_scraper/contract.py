# FICHIER GÉNÉRÉ — ne pas éditer.
# Source : validateurs Zod de apps/api/src/modules/ingestion/ingestion.validator.ts
#   → apps/api/contracts/ingestion.schema.json → datamodel-codegen.
# Régénérer : `pnpm contract:generate` à la racine du monorepo.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated
from pydantic import AnyUrl, AwareDatetime, Field
from manhwa_scraper.contract_base import ContractModel
from typing_extensions import TypeAliasType
from uuid import UUID


class ChapterKind(StrEnum):
    regular = "regular"
    extra = "extra"
    side_story = "side_story"
    prologue = "prologue"
    epilogue = "epilogue"
    notice = "notice"


class ChapterQuality(StrEnum):
    hd = "hd"
    sd = "sd"
    raw = "raw"


StatsAdditionalProperty = TypeAliasType("StatsAdditionalProperty", Annotated[int, Field(ge=0, le=9007199254740991)])


type Error = Annotated[str, Field(max_length=10000)]


type HttpStatus = Annotated[int, Field(ge=100, le=599)]


type LatencyMs = Annotated[int, Field(ge=0, le=600000)]


type BlockedBy = Annotated[str, Field(max_length=50)]


class HealthStatus(StrEnum):
    up = "up"
    degraded = "degraded"
    blocked = "blocked"
    down = "down"


type Title = Annotated[str, Field(max_length=500)]


type ScanlationGroup = Annotated[str, Field(max_length=100, min_length=1)]


class IngestChapter(ContractModel):
    url: AnyUrl
    language: Annotated[str, Field(max_length=10, min_length=2)]
    quality: ChapterQuality | None = None
    published_at: Annotated[AwareDatetime | None, Field(alias="publishedAt")] = None
    number: Annotated[float, Field(ge=0.0, le=999999.99, multiple_of=0.01)]
    title: Title | None = None
    kind: ChapterKind | None = None
    scanlation_group: Annotated[ScanlationGroup | None, Field(alias="scanlationGroup")] = None
    scanlation_groups: Annotated[list[ScanlationGroup] | None, Field(alias="scanlationGroups", max_length=5)] = None


type OriginalTitle = Annotated[str, Field(max_length=500)]


type Synopsis = Annotated[str, Field(max_length=10000)]


type TotalChapters = Annotated[int, Field(ge=0, le=9007199254740991)]


class ManhwaStatus(StrEnum):
    ongoing = "ongoing"
    completed = "completed"
    hiatus = "hiatus"
    cancelled = "cancelled"


class ManhwaType(StrEnum):
    manga = "manga"
    manhwa = "manhwa"
    manhua = "manhua"
    webtoon = "webtoon"


class RunOutcome(StrEnum):
    succeeded = "succeeded"
    partial = "partial"
    failed = "failed"


type WorkerVersion = Annotated[str, Field(max_length=50)]


class StartRun(ContractModel):
    source_id: Annotated[UUID, Field(alias="sourceId")]
    worker_version: Annotated[WorkerVersion | None, Field(alias="workerVersion")] = None


type LatestChapter = Annotated[float, Field(ge=0.0, le=999999.99, multiple_of=0.01)]


class TrackedSeries(ContractModel):
    manhwa_id: Annotated[UUID, Field(alias="manhwaId")]
    manhwa_url: Annotated[AnyUrl | None, Field(alias="manhwaUrl")]
    latest_chapter: Annotated[LatestChapter | None, Field(alias="latestChapter")]
    last_scraped_at: Annotated[AwareDatetime | None, Field(alias="lastScrapedAt")]
    title: str


class TrackedSeriesPage(ContractModel):
    data: list[TrackedSeries]
    next_cursor: Annotated[UUID | None, Field(alias="nextCursor")]


class TrackedSeriesQuery(ContractModel):
    source_id: Annotated[UUID, Field(alias="sourceId")]
    cursor: UUID | None = None
    limit: Annotated[int, Field(ge=1, le=500)] = 100


class FinishRun(ContractModel):
    status: RunOutcome
    stats: dict[str, StatsAdditionalProperty] | None = None
    error: Error | None = None


class HealthSample(ContractModel):
    source_id: Annotated[UUID, Field(alias="sourceId")]
    scrape_run_id: Annotated[UUID | None, Field(alias="scrapeRunId")] = None
    status: HealthStatus
    http_status: Annotated[HttpStatus | None, Field(alias="httpStatus")] = None
    latency_ms: Annotated[LatencyMs | None, Field(alias="latencyMs")] = None
    blocked_by: Annotated[BlockedBy | None, Field(alias="blockedBy")] = None
    checked_at: Annotated[AwareDatetime | None, Field(alias="checkedAt")] = None


class IngestManhwa(ContractModel):
    title: Annotated[str, Field(max_length=500, min_length=1)]
    original_title: Annotated[OriginalTitle | None, Field(alias="originalTitle")] = None
    synopsis: Synopsis | None = None
    cover_url: Annotated[AnyUrl | None, Field(alias="coverUrl")] = None
    type: ManhwaType | None = None
    status: ManhwaStatus | None = None
    total_chapters: Annotated[TotalChapters | None, Field(alias="totalChapters")] = None
    source_manhwa_url: Annotated[AnyUrl, Field(alias="sourceManhwaUrl")]
    manhwa_id: Annotated[UUID | None, Field(alias="manhwaId")] = None
    chapters: Annotated[list[IngestChapter], Field(max_length=2000, validate_default=True)] = []


class RecordHealth(ContractModel):
    samples: Annotated[list[HealthSample], Field(max_length=500, min_length=1)]


class IngestBatch(ContractModel):
    source_id: Annotated[UUID, Field(alias="sourceId")]
    scrape_run_id: Annotated[UUID | None, Field(alias="scrapeRunId")] = None
    manhwas: Annotated[list[IngestManhwa], Field(max_length=100, min_length=1)]


type Model = IngestBatch
