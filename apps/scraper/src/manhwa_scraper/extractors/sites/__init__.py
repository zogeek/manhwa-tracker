"""Sources concrètes. Ajouter un site = une classe ici + une ligne dans `ALL_SOURCES`."""

from ..base import SourceExtractor
from ..registry import ExtractorRegistry
from .astral_manga import AstralMangaExtractor
from .mangas_origines import MangasOriginesExtractor
from .rimuscan import RimuScanExtractor
from .scan_manga import ScanMangaExtractor

ALL_SOURCES: tuple[type[SourceExtractor], ...] = (
    AstralMangaExtractor,
    MangasOriginesExtractor,
    RimuScanExtractor,
    ScanMangaExtractor,
)


def default_registry() -> ExtractorRegistry:
    return ExtractorRegistry(ALL_SOURCES)
