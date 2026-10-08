"""CLI : aiguillage des commandes `track` / `search`, sans réseau (moteur et runs simulés)."""

from collections.abc import Sequence
from pathlib import Path
from uuid import UUID

import pytest

from manhwa_scraper import cli
from manhwa_scraper.config import Settings
from manhwa_scraper.contract import RunOutcome
from manhwa_scraper.extractors import SourceExtractor
from manhwa_scraper.pipeline import RunReport, RunStats

SOURCE_ID = "0c7e1f0a-0000-4000-8000-000000000001"


@pytest.fixture(autouse=True)
def isolated_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Ni le `.env` du développeur ni sa vraie clé Brave ne doivent fuiter dans les tests."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("BRAVE_SEARCH_API_KEY", raising=False)


class TestSearch:
    def test_prints_the_series_url(self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
        seen: list[tuple[str, type[SourceExtractor], str]] = []

        async def fake_search(api_key: str, extractor_cls: type[SourceExtractor], title: str) -> str | None:
            seen.append((api_key, extractor_cls, title))
            return "https://www.scan-manga.com/1805-54398/Solo-Leveling.html"

        monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "cle")
        monkeypatch.setattr(cli, "_search", fake_search)

        assert cli.main(["search", "scan-manga", "Solo Leveling"]) == 0
        assert capsys.readouterr().out == "https://www.scan-manga.com/1805-54398/Solo-Leveling.html\n"
        assert [(key, cls.slug, title) for key, cls, title in seen] == [("cle", "scan-manga", "Solo Leveling")]

    def test_not_found_exits_1(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def fake_search(api_key: str, extractor_cls: type[SourceExtractor], title: str) -> str | None:
            return None

        monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "cle")
        monkeypatch.setattr(cli, "_search", fake_search)

        assert cli.main(["search", "scan-manga", "Introuvable"]) == 1

    def test_requires_the_brave_key(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert cli.main(["search", "scan-manga", "Solo"]) == 2
        assert "brave_search_api_key" in capsys.readouterr().err


class TestTrack:
    def test_rejects_urls_from_different_sources(self, capsys: pytest.CaptureFixture[str]) -> None:
        argv = [
            "track",
            "https://mangas-origines.fr/oeuvre/solo/",
            "https://www.scan-manga.com/1805/Solo.html",
            "--source-id",
            SOURCE_ID,
        ]

        assert cli.main(argv) == 2
        assert "même source" in capsys.readouterr().err

    def test_rejects_a_skeleton_source(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert cli.main(["track", "https://rimuscan.fr/manga/solo/", "--source-id", SOURCE_ID]) == 2
        assert "squelette" in capsys.readouterr().err

    def test_runs_the_tracked_series_normalised_to_their_series_page(self, monkeypatch: pytest.MonkeyPatch) -> None:
        runs: list[tuple[str, UUID, int | None, Sequence[str] | None]] = []

        async def fake_run(
            settings: Settings,
            extractor_cls: type[SourceExtractor],
            source_id: UUID,
            *,
            max_series: int | None = None,
            urls: Sequence[str] | None = None,
        ) -> RunReport:
            runs.append((extractor_cls.slug, source_id, max_series, urls))
            return RunReport(UUID(SOURCE_ID), RunOutcome.succeeded, RunStats())

        monkeypatch.setenv("SCRAPER_API_URL", "http://api.test")
        monkeypatch.setenv("SCRAPER_API_KEY", "k" * 32)
        monkeypatch.setattr(cli, "_run", fake_run)
        argv = [
            "track",
            "https://mangas-origines.fr/oeuvre/solo/chapitre-3/",
            "https://www.mangas-origines.fr/oeuvre/necro/",
            "--source-id",
            SOURCE_ID,
        ]

        assert cli.main(argv) == 0
        assert runs == [
            (
                "mangas-origines",
                UUID(SOURCE_ID),
                None,
                ["https://mangas-origines.fr/oeuvre/solo/", "https://mangas-origines.fr/oeuvre/necro/"],
            )
        ]
