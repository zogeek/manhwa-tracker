"""Validation des arguments : tout refus intervient avant la lecture de la configuration et sans réseau."""

from pathlib import Path
from uuid import UUID

import pytest

from manhwa_scraper import cli
from manhwa_scraper.cli import RunContext, RunPlan, main
from manhwa_scraper.config import SearchSettings, Settings
from manhwa_scraper.contract import RunOutcome
from manhwa_scraper.extractors import SourceExtractor
from manhwa_scraper.ingest_client import IngestClient, create_http_client
from manhwa_scraper.pipeline import RunReport, RunStats, ScrapeTarget
from manhwa_scraper.search import BraveSearchEngine, SearchError, SearxngSearchEngine, SeriesFinder

from .fakes import FakeFetcher, FakeIngestApi, tracked_series

SOURCE_ID = "0c7e1f0a-0000-4000-8000-000000000001"
SERIES_ID = "a1000000-0000-4000-8000-000000000001"


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


@pytest.fixture
def collected_targets(monkeypatch: pytest.MonkeyPatch) -> list[str | ScrapeTarget]:
    """Remplace `_run` : les cibles du run sont collectées (API simulée par `FakeIngestApi`), rien n'est scrapé."""
    seen: list[str | ScrapeTarget] = []

    async def fake_run(
        settings: Settings,
        search: SearchSettings | None,
        plan: RunPlan,
        source_id: UUID,
        max_series: int | None,
    ) -> RunReport:
        api = FakeIngestApi(tracked=[tracked_series(SERIES_ID, "Necro", "https://mangas-origines.fr/oeuvre/necro/")])
        async with create_http_client("http://api.test", "k" * 32, transport=api.transport()) as http:
            context = RunContext(plan.extractor_cls(FakeFetcher()), IngestClient(http), source_id, SeriesFinder(None))
            seen.extend([target async for target in plan.targets(context)])
        return RunReport(source_id, RunOutcome.succeeded, RunStats())

    monkeypatch.setenv("SCRAPER_API_URL", "http://api.test")
    monkeypatch.setenv("SCRAPER_API_KEY", "k" * 32)
    monkeypatch.setattr(cli, "_run", fake_run)
    return seen


def test_track_brings_chapter_links_back_to_their_series_page(collected_targets: list[str | ScrapeTarget]) -> None:
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
    assert collected_targets == ["https://mangas-origines.fr/oeuvre/solo/", "https://mangas-origines.fr/oeuvre/necro/"]


class TestTrackFromApi:
    def test_reads_the_tracked_series_from_the_api(self, collected_targets: list[str | ScrapeTarget]) -> None:
        assert main(["track", "--source-id", SOURCE_ID, "--from-api", "mangas-origines"]) == 0
        assert collected_targets == [
            ScrapeTarget(url="https://mangas-origines.fr/oeuvre/necro/", manhwa_id=UUID(SERIES_ID))
        ]

    def test_refuses_urls_alongside(self, capsys: pytest.CaptureFixture[str]) -> None:
        code = main(
            ["track", "--source-id", SOURCE_ID, "--from-api", "mangas-origines", "https://mangas-origines.fr/oeuvre/a/"]
        )

        assert code == 2
        assert "ne pas donner d'URL" in capsys.readouterr().err

    def test_refuses_an_unknown_source(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["track", "--source-id", SOURCE_ID, "--from-api", "inconnue"]) == 2
        assert "inconnue" in capsys.readouterr().err

    def test_refuses_a_skeleton_source(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["track", "--source-id", SOURCE_ID, "--from-api", "rimuscan"]) == 2
        assert "squelette" in capsys.readouterr().err

    async def test_runs_without_a_search_engine(self) -> None:
        async with cli._finder(SearchSettings()) as finder:
            assert finder is not None  # les sources à recherche native restent cherchables

    async def test_uses_the_configured_search_engine(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SEARXNG_URL", "http://localhost:8080")

        async with cli._finder(SearchSettings()) as finder:
            assert finder is not None


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
