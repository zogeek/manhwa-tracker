from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import ValidationError

from manhwa_scraper.config import Settings
from manhwa_scraper.models import IngestBatch, ScrapedChapter, ScrapedManhwa, to_payload

SOURCE_ID = UUID("0c7e1f0a-0000-4000-8000-000000000001")


def manhwa(**overrides: object) -> ScrapedManhwa:
    return ScrapedManhwa.model_validate(
        {"source_manhwa_url": "https://scan.test/manga/solo/", "title": "Solo"} | overrides
    )


def test_payload_matches_the_api_contract() -> None:
    chapter = ScrapedChapter(
        number=Decimal("12.5"),
        url="https://scan.test/manga/solo/12-5/",
        published_at=datetime(2025, 1, 12, 8, 30, tzinfo=UTC),
        scanlation_groups=["  Team A "],
    )
    batch = IngestBatch(source_id=SOURCE_ID, manhwas=[manhwa(chapters=[chapter])])

    assert to_payload(batch) == {
        "sourceId": str(SOURCE_ID),
        "manhwas": [
            {
                "sourceManhwaUrl": "https://scan.test/manga/solo/",
                "title": "Solo",
                "chapters": [
                    {
                        "number": 12.5,  # nombre JSON, pas une chaîne
                        "url": "https://scan.test/manga/solo/12-5/",
                        "language": "fr",
                        "publishedAt": "2025-01-12T08:30:00Z",
                        "scanlationGroups": ["Team A"],
                    }
                ],
            }
        ],
    }


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": "   "},
        {"cover_url": "pas-une-url"},
        {"status": "unknown"},
        {"unexpected": "champ"},  # une coquille d'extracteur doit échouer ici, pas en 400 côté API
    ],
)
def test_rejects_invalid_series(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        manhwa(**overrides)


def test_rejects_naive_dates_and_too_precise_chapter_numbers() -> None:
    with pytest.raises(ValidationError):
        ScrapedChapter(number=Decimal(1), url="https://scan.test/1/", published_at=datetime(2025, 1, 1))
    with pytest.raises(ValidationError):
        ScrapedChapter(number=Decimal("1.555"), url="https://scan.test/1/")


def test_batch_needs_at_least_one_series() -> None:
    with pytest.raises(ValidationError):
        IngestBatch(source_id=SOURCE_ID, manhwas=[])


class TestSettings:
    def test_reads_prefixed_environment(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SCRAPER_API_URL", "http://localhost:3001")
        monkeypatch.setenv("SCRAPER_API_KEY", "k" * 32)
        monkeypatch.setenv("SCRAPER_HEADLESS", "false")

        settings = Settings(_env_file=None)

        assert settings.headless is False
        assert "k" * 32 not in repr(settings)  # la clé ne fuit pas dans les logs

    def test_rejects_a_short_api_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SCRAPER_API_URL", "http://localhost:3001")
        monkeypatch.setenv("SCRAPER_API_KEY", "trop-courte")

        with pytest.raises(ValidationError):
            Settings(_env_file=None)
