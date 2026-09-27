"""Modèles générés depuis le contrat Zod de l'API : synchronisation, sérialisation, règles de validation."""

import ast
import subprocess
import sys
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pytest
from pydantic import ValidationError

from manhwa_scraper.config import Settings
from manhwa_scraper.contract import IngestBatch, IngestChapter, IngestManhwa, ManhwaStatus
from manhwa_scraper.models import to_payload

SCRAPER_ROOT = Path(__file__).parents[1]
GENERATED = SCRAPER_ROOT / "src" / "manhwa_scraper" / "contract.py"
SOURCE_ID = UUID("0c7e1f0a-0000-4000-8000-000000000001")


def test_generated_models_match_the_api_contract(tmp_path: Path) -> None:
    """Échoue si `ingestion.schema.json` a changé sans que `contract.py` ait été régénéré."""
    fresh = tmp_path / "contract.py"
    subprocess.run(
        [sys.executable, "-m", "datamodel_code_generator", "--output", str(fresh)],
        cwd=SCRAPER_ROOT,  # lit [tool.datamodel-codegen] dans pyproject.toml
        check=True,
        capture_output=True,
    )

    # Comparaison de l'arbre syntaxique : le formatteur suit la config ruff du dossier de sortie
    # (ici hors projet), seule la structure du code compte.
    assert _ast(fresh) == _ast(GENERATED), (
        "Modèles désynchronisés : lancer `pnpm contract:generate` à la racine et commiter le résultat."
    )


def _ast(path: Path) -> str:
    return ast.dump(ast.parse(path.read_text(encoding="utf-8")))


def manhwa(**overrides: object) -> IngestManhwa:
    return IngestManhwa.model_validate(
        {"source_manhwa_url": "https://scan.test/manga/solo/", "title": "Solo"} | overrides
    )


def test_payload_matches_the_api_contract() -> None:
    chapter = IngestChapter(
        number=Decimal("12.5"),
        url="https://scan.test/manga/solo/12-5/",
        language="fr",
        published_at=datetime(2025, 1, 12, 8, 30, tzinfo=UTC),
        scanlation_groups=["Team A"],
    )
    batch = IngestBatch(source_id=SOURCE_ID, manhwas=[manhwa(status=ManhwaStatus.ongoing, chapters=[chapter])])

    assert to_payload(batch) == {
        "sourceId": str(SOURCE_ID),
        "manhwas": [
            {
                "sourceManhwaUrl": "https://scan.test/manga/solo/",
                "title": "Solo",
                "status": "ongoing",
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


def test_chapters_default_to_an_empty_list_like_the_api() -> None:
    assert manhwa().chapters == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": ""},
        {"cover_url": "pas-une-url"},
        {"status": "unknown"},
        {"unexpected": "champ"},  # une coquille d'extracteur doit échouer ici, pas en 400 côté API
    ],
)
def test_rejects_invalid_series(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        manhwa(**overrides)


@pytest.mark.parametrize(
    "fields",
    [
        {"number": 1, "url": "https://scan.test/1/"},  # `language` est obligatoire dans le contrat
        {"number": 1, "url": "https://scan.test/1/", "language": "fr", "published_at": datetime(2025, 1, 1)},
        {"number": Decimal("1.555"), "url": "https://scan.test/1/", "language": "fr"},  # 2 décimales max
    ],
)
def test_rejects_invalid_chapters(fields: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        IngestChapter.model_validate(fields)


def test_models_are_frozen() -> None:
    with pytest.raises(ValidationError):
        manhwa().title = "Autre"  # type: ignore[misc]


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
