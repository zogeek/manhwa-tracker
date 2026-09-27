from typing import ClassVar

import pytest

from manhwa_scraper.extractors import ExtractorRegistry, SourceExtractor, UnknownSourceError
from manhwa_scraper.extractors.sites import ALL_SOURCES, default_registry
from manhwa_scraper.extractors.sites.mangas_origines import MangasOriginesExtractor
from manhwa_scraper.extractors.themes import MadaraExtractor

from .fakes import FakeFetcher


def test_registers_the_four_target_sources() -> None:
    assert [extractor.slug for extractor in default_registry().all()] == [
        "astral-manga",
        "mangas-origines",
        "rimuscan",
        "scan-manga",
    ]


@pytest.mark.parametrize("extractor", ALL_SOURCES)
def test_every_source_is_concrete_and_well_formed(extractor: type[SourceExtractor]) -> None:
    instance = extractor(FakeFetcher())  # lèverait TypeError si une méthode abstraite manquait
    assert instance.base_url.startswith("https://")
    assert instance.base_url.endswith("/")
    assert instance.handles(instance.base_url)


def test_skeletons_are_not_ready_to_run() -> None:
    assert [extractor.slug for extractor in ALL_SOURCES if extractor.ready] == []


def test_resolves_a_source_from_any_of_its_urls() -> None:
    registry = default_registry()
    assert registry.for_url("https://www.mangas-origines.fr/oeuvre/solo/") is MangasOriginesExtractor
    with pytest.raises(UnknownSourceError):
        registry.for_url("https://inconnu.test/")


def test_factory_injects_the_fetcher() -> None:
    extractor = default_registry().create("mangas-origines", FakeFetcher())
    assert isinstance(extractor, MadaraExtractor)
    assert extractor.catalog_page_url(1) == "https://mangas-origines.fr/oeuvre/?m_orderby=latest"


def test_unknown_slug_lists_the_available_ones() -> None:
    with pytest.raises(UnknownSourceError, match="rimuscan"):
        default_registry().get("nope")


def test_rejects_duplicate_slugs() -> None:
    class Clone(MangasOriginesExtractor):
        name: ClassVar[str] = "Clone"

    with pytest.raises(ValueError, match="double"):
        ExtractorRegistry([MangasOriginesExtractor, Clone])
