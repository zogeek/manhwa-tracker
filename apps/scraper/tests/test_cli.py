"""Validation des arguments : tout refus intervient avant la lecture de la configuration et sans réseau."""

from pathlib import Path
from uuid import UUID

import pytest

from manhwa_scraper import cli
from manhwa_scraper.cli import Targets, main
from manhwa_scraper.config import SearchSettings, Settings
from manhwa_scraper.contract import RunOutcome
from manhwa_scraper.extractors import SourceExtractor
from manhwa_scraper.pipeline import RunReport, RunStats
from manhwa_scraper.search import BraveSearchEngine, SearchError, SearxngSearchEngine

from .fakes import FakeFetcher

SOURCE_ID = "0c7e1f0a-0000-4000-8000-000000000001"


@pytest.fixture(autouse=True)
def no_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sans configuration, un argument accepté à tort échouerait plus loin (ValidationError) : sortie 2 aussi,
    mais avec un autre message — chaque test vérifie donc le message, pas seulement le code."""
    for name in ("SCRAPER_API_URL", "SCRAPER_API_KEY", "BRAVE_SEARCH_API_KEY", "SEARXNG_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(Path(__file__).parent)  # pas de `.env` ici


def test_track_rejects_urls_from_several_sources(capsys: pytest.CaptureFixture[str]) -> None:
    code = main(
        [
            "track",
            "--source-id",
            SOURCE_ID,
            "https://www.scan-manga.com/1/A.html",
            "https://mangas-origines.fr/oeuvre/b/",
        ]
    )

    assert code == 2
    assert "même source" in capsys.readouterr().err


def test_track_reads_urls_from_a_file(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    urls_file = tmp_path / "suivies.txt"
    urls_file.write_text("# séries suivies\n\nhttps://inconnu.test/serie\n", encoding="utf-8")

    code = main(["track", "--source-id", SOURCE_ID, "--urls-file", str(urls_file)])

    assert code == 2
    assert "Aucune source ne gère https://inconnu.test/serie" in capsys.readouterr().err


def test_track_requires_at_least_one_url(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["track", "--source-id", SOURCE_ID]) == 2
    assert "Aucune URL" in capsys.readouterr().err


def test_track_refuses_a_skeleton_source(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["track", "--source-id", SOURCE_ID, "https://rimuscan.fr/manga/x"]) == 2
    assert "squelette" in capsys.readouterr().err


def test_top_discovery_needs_a_source_that_exposes_one(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["run", "mangas-origines", "--source-id", SOURCE_ID, "--discovery", "top"]) == 2
    assert "n'expose pas de Top" in capsys.readouterr().err


def test_a_valid_track_command_only_then_reads_the_configuration(capsys: pytest.CaptureFixture[str]) -> None:
    code = main(["track", "--source-id", SOURCE_ID, "https://www.scan-manga.com/17231/La-Tour-Sans-Fin.html"])

    assert code == 2
    assert "api_url" in capsys.readouterr().err  # arguments acceptés : c'est la configuration absente qui bloque


def test_track_brings_chapter_links_back_to_their_series_page(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    async def fake_run(
        settings: Settings,
        extractor_cls: type[SourceExtractor],
        targets: Targets,
        source_id: UUID,
        max_series: int | None,
    ) -> RunReport:
        seen.extend([url async for url in targets(extractor_cls(FakeFetcher()))])
        return RunReport(source_id, RunOutcome.succeeded, RunStats())

    monkeypatch.setenv("SCRAPER_API_URL", "http://api.test")
    monkeypatch.setenv("SCRAPER_API_KEY", "k" * 32)
    monkeypatch.setattr(cli, "_run", fake_run)

    code = main(
        [
            "track",
            "--source-id",
            SOURCE_ID,
            "https://mangas-origines.fr/oeuvre/solo/chapitre-3/",
            "https://www.mangas-origines.fr/oeuvre/necro",
        ]
    )

    assert code == 0
    assert seen == ["https://mangas-origines.fr/oeuvre/solo/", "https://mangas-origines.fr/oeuvre/necro/"]


class TestSearch:
    def test_prints_the_series_url(self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
        seen: list[tuple[str | None, str, str]] = []

        async def fake_search(settings: SearchSettings, extractor_cls: type[SourceExtractor], title: str) -> str | None:
            seen.append((str(settings.searxng_url), extractor_cls.slug, title))
            return "https://www.scan-manga.com/1805-54398/Solo-Leveling.html"

        monkeypatch.setenv("SEARXNG_URL", "http://localhost:8080")
        monkeypatch.setattr(cli, "_search", fake_search)

        assert main(["search", "scan-manga", "Solo Leveling"]) == 0
        assert capsys.readouterr().out == "https://www.scan-manga.com/1805-54398/Solo-Leveling.html\n"
        assert seen == [("http://localhost:8080/", "scan-manga", "Solo Leveling")]

    def test_not_found_exits_1(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def fake_search(settings: SearchSettings, extractor_cls: type[SourceExtractor], title: str) -> str | None:
            return None

        monkeypatch.setattr(cli, "_search", fake_search)

        assert main(["search", "scan-manga", "Introuvable"]) == 1

    def test_without_any_engine_asks_for_searxng(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["search", "scan-manga", "Solo"]) == 2
        assert "SEARXNG_URL" in capsys.readouterr().err


class TestSearchEngineSelection:
    async def test_searxng_takes_priority_over_brave(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SEARXNG_URL", "http://localhost:8080")
        monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "cle")

        async with cli._search_engine(SearchSettings()) as engine:
            assert isinstance(engine, SearxngSearchEngine)

    async def test_brave_is_only_a_fallback(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "cle")

        async with cli._search_engine(SearchSettings()) as engine:
            assert isinstance(engine, BraveSearchEngine)

    async def test_no_engine_configured(self) -> None:
        with pytest.raises(SearchError, match="SEARXNG_URL"):
            async with cli._search_engine(SearchSettings()):
                pass
