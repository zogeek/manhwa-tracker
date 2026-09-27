"""Contrat de données du worker, calqué sur `apps/api/src/modules/ingestion/ingestion.validator.ts`.

Valider côté worker ne remplace pas la validation de l'API (Zero Trust) : ça permet d'échouer tôt,
avec une erreur lisible, plutôt que de recevoir un 400 après un scraping de plusieurs minutes.
Les champs sont en snake_case côté Python et sérialisés en camelCase (`model_dump(by_alias=True)`).
"""

from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, HttpUrl, PlainSerializer, StringConstraints
from pydantic.alias_generators import to_camel

ManhwaType = Literal["manga", "manhwa", "manhua", "webtoon"]
ManhwaStatus = Literal["ongoing", "completed", "hiatus", "cancelled"]
ChapterKind = Literal["regular", "extra", "side_story", "prologue", "epilogue", "notice"]
ChapterQuality = Literal["hd", "sd", "raw"]
RunOutcome = Literal["succeeded", "partial", "failed"]
HealthStatus = Literal["up", "degraded", "blocked", "down"]

TeamName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
# Mêmes bornes que `chapterNumberSchema` : positif, 2 décimales max (ex. 12.5 pour un chapitre intermédiaire).
# Decimal évite les arrondis flottants à la lecture ; l'API attend un nombre JSON, pas une chaîne.
ChapterNumber = Annotated[
    Decimal,
    Field(ge=0, le=Decimal("999999.99"), decimal_places=2),
    PlainSerializer(float, return_type=float, when_used="json"),
]


class ContractModel(BaseModel):
    """Corps envoyés à l'API : stricts (champ inconnu = bug d'extracteur) et immuables."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        extra="forbid",
        frozen=True,
    )


class ResponseModel(BaseModel):
    """Réponses de l'API : on ignore les champs inconnus pour tolérer les évolutions du contrat."""

    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True, validate_by_alias=True, extra="ignore")


class ScrapedChapter(ContractModel):
    number: ChapterNumber
    url: HttpUrl
    language: Annotated[str, StringConstraints(min_length=2, max_length=10)] = "fr"
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    kind: ChapterKind | None = None
    quality: ChapterQuality | None = None
    published_at: AwareDatetime | None = None
    scanlation_groups: Annotated[list[TeamName], Field(max_length=5)] = []


class SeriesMetadata(ContractModel):
    """Fiche d'une œuvre telle que lue sur sa page, avant la collecte (parfois séparée) des chapitres."""

    source_manhwa_url: HttpUrl
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    original_title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    synopsis: Annotated[str, StringConstraints(max_length=10_000)] | None = None
    cover_url: HttpUrl | None = None
    type: ManhwaType | None = None
    status: ManhwaStatus | None = None
    total_chapters: Annotated[int, Field(ge=0)] | None = None


class ScrapedManhwa(SeriesMetadata):
    chapters: Annotated[list[ScrapedChapter], Field(max_length=2_000)] = []

    @classmethod
    def assemble(cls, metadata: SeriesMetadata, chapters: list[ScrapedChapter]) -> "ScrapedManhwa":
        return cls.model_validate({**metadata.model_dump(), "chapters": chapters})


class IngestBatch(ContractModel):
    source_id: UUID
    scrape_run_id: UUID | None = None
    manhwas: Annotated[list[ScrapedManhwa], Field(min_length=1, max_length=100)]


class HealthSample(ContractModel):
    source_id: UUID
    status: HealthStatus
    scrape_run_id: UUID | None = None
    http_status: Annotated[int, Field(ge=100, le=599)] | None = None
    latency_ms: Annotated[int, Field(ge=0, le=600_000)] | None = None
    blocked_by: Annotated[str, StringConstraints(max_length=50)] | None = None
    checked_at: AwareDatetime | None = None


class ScrapeRun(ResponseModel):
    id: UUID
    status: str


class BatchResult(ResponseModel):
    chapters_created: int
    releases_created: int
    releases_updated: int
    covers_added: int


class HealthResult(ResponseModel):
    recorded: int


def to_payload(model: ContractModel) -> dict[str, object]:
    """Corps JSON attendu par l'API : camelCase, sans les champs absents, dates ISO 8601 avec fuseau."""
    return model.model_dump(mode="json", by_alias=True, exclude_none=True)
