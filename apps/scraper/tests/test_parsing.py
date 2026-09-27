from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from manhwa_scraper.extractors.parsing import PARIS, parse_chapter_number, parse_date, parse_status, parse_type

NOW = datetime(2026, 9, 27, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("Chapitre 12", Decimal(12)),
        ("Chapitre 12.5 - Le retour", Decimal("12.5")),
        ("Ch. 7", Decimal(7)),
        ("chapter 3,5", Decimal("3.5")),
        ("Épisode 40", Decimal(40)),
        ("Saison 2 Chapitre 105", Decimal(105)),  # le numéro de chapitre prime sur celui de saison
        ("105", Decimal(105)),
        ("Annonce", None),
    ],
)
def test_parse_chapter_number(label: str, expected: Decimal | None) -> None:
    assert parse_chapter_number(label) == expected


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("En cours", "ongoing"),
        ("OnGoing", "ongoing"),
        ("Terminé", "completed"),
        ("Completed", "completed"),
        ("En pause", "hiatus"),
        ("Abandonné", "cancelled"),
        ("Dropped", "cancelled"),
        ("???", None),
        (None, None),
    ],
)
def test_parse_status(label: str | None, expected: str | None) -> None:
    assert parse_status(label) == expected


def test_parse_type() -> None:
    assert parse_type("Manhwa") == "manhwa"
    assert parse_type("Webtoon coréen") == "webtoon"
    assert parse_type("Roman") is None


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("12 janvier 2025", datetime(2025, 1, 12, tzinfo=PARIS)),
        ("1 août 2024", datetime(2024, 8, 1, tzinfo=PARIS)),
        ("March 5, 2025", datetime(2025, 3, 5, tzinfo=PARIS)),
        ("février 3, 2025", datetime(2025, 2, 3, tzinfo=PARIS)),
        ("03/02/2025", datetime(2025, 2, 3, tzinfo=PARIS)),
        ("il y a 3 heures", NOW - timedelta(hours=3)),
        ("2 days ago", NOW - timedelta(days=2)),
        ("il y a 1 semaine", NOW - timedelta(weeks=1)),
        ("Hier", NOW - timedelta(days=1)),
        ("bientôt", None),
        (None, None),
    ],
)
def test_parse_date(label: str | None, expected: datetime | None) -> None:
    parsed = parse_date(label, now=NOW)
    assert parsed == expected
    assert parsed is None or parsed.tzinfo is not None  # l'API exige un fuseau
