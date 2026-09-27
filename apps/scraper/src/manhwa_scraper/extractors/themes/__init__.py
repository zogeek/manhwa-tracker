"""Implémentations par CMS : un site bâti sur l'un d'eux n'a qu'à déclarer son URL."""

from .madara import MadaraExtractor, MadaraSelectors
from .mangathemesia import MangaThemesiaExtractor, MangaThemesiaSelectors

__all__ = ["MadaraExtractor", "MadaraSelectors", "MangaThemesiaExtractor", "MangaThemesiaSelectors"]
