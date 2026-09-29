"""Validation des arguments : tout refus intervient avant la lecture de la configuration et sans réseau."""

from pathlib import Path

import pytest

from manhwa_scraper.cli import main

SOURCE_ID = "0c7e1f0a-0000-4000-8000-000000000001"


@pytest.fixture(autouse=True)
def no_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sans configuration, un argument accepté à tort échouerait plus loin (ValidationError) : sortie 2 aussi,
    mais avec un autre message — chaque test vérifie donc le message, pas seulement le code."""
    for name in ("SCRAPER_API_URL", "SCRAPER_API_KEY"):
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
