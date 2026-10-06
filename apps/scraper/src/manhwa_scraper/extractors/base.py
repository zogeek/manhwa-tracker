"""Classe abstraite commune à toutes les sources (pattern « Template Method »).

Le déroulé d'un scraping est toujours le même — lister les œuvres, télécharger une fiche, en extraire
les métadonnées puis les chapitres — seules les étapes « lire le HTML » changent d'un site à l'autre.
`SourceExtractor` fixe ce déroulé ; les thèmes (Madara, MangaThemesia) implémentent les étapes pour
tout un CMS ; un site n'a plus qu'à déclarer son URL et, au besoin, surcharger quelques sélecteurs.

Les méthodes `parse_*` sont pures (HTML → modèles) : on les teste sur des fixtures, sans réseau.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import ClassVar
from urllib.parse import urlsplit

from selectolax.lexbor import LexborHTMLParser

from ..contract import IngestChapter, IngestManhwa
from ..fetching import FetchError, PageFetcher


class ExtractionError(RuntimeError):
    """La page a été récupérée mais ne ressemble pas à ce que l'extracteur attend (sélecteur cassé, refonte du site)."""


class UnsupportedSeriesError(ExtractionError):
    """Fiche valide mais hors du catalogue suivi (ex. un roman) : ignorée, sans compter comme un échec."""


class UnsupportedDiscoveryError(LookupError):
    """La source n'expose pas ce mode de découverte (ex. pas de « Top » servi côté serveur)."""


@dataclass(frozen=True, slots=True)
class SeriesLink:
    """Œuvre repérée sur une page de listing, avant téléchargement de sa fiche."""

    title: str
    url: str


class SourceExtractor(ABC):
    slug: ClassVar[str]
    """Identifiant stable, utilisé en ligne de commande (`manhwa-scraper run <slug>`)."""
    name: ClassVar[str]
    base_url: ClassVar[str]
    """Origine du site, avec `/` final (ex. `https://exemple.fr/`)."""
    language: ClassVar[str] = "fr"
    ready: ClassVar[bool] = False
    """`False` tant que les sélecteurs n'ont pas été validés sur le site réel : la CLI refuse de le lancer."""
    max_catalog_pages: ClassVar[int] = 500
    """Garde-fou contre une pagination qui ne s'arrête jamais (page « suivante » qui boucle)."""
    top_page_url: ClassVar[str | None] = None
    """Page qui porte le « Top » des œuvres populaires ; `None` = la source n'en expose pas (voir `parse_top`)."""

    def __init__(self, fetcher: PageFetcher) -> None:
        self._fetcher = fetcher

    @classmethod
    def handles(cls, url: str) -> bool:
        """Cette source est-elle celle de `url` (sous-domaines `www.` compris) ?"""
        host = (urlsplit(url).hostname or "").removeprefix("www.")
        return host == (urlsplit(cls.base_url).hostname or "").removeprefix("www.")

    # ---- Déroulé (template method) ----

    async def discover(self) -> AsyncIterator[str]:
        """URLs de toutes les fiches du catalogue, sans doublon, page après page."""
        seen: set[str] = set()
        for page in range(1, self.max_catalog_pages + 1):
            try:
                result = await self._fetcher.fetch(self.catalog_page_url(page))
            except FetchError as error:
                # WordPress répond 404 au-delà de la dernière page : c'est la fin du catalogue, pas une panne.
                # Sur la page 1, en revanche, un 404 signale une URL de catalogue erronée.
                if error.status == 404 and page > 1:
                    return
                raise
            urls = [
                url for url in self.parse_catalog_page(LexborHTMLParser(result.html), result.url) if url not in seen
            ]
            if not urls:
                return
            for url in urls:
                seen.add(url)
                yield url

    async def discover_top(self) -> AsyncIterator[str]:
        """URLs des œuvres du « Top » du site, dans l'ordre du classement : une seule requête."""
        if self.top_page_url is None:
            raise UnsupportedDiscoveryError(f"La source « {self.slug} » n'expose pas de Top")
        result = await self._fetcher.fetch(self.top_page_url)
        seen: set[str] = set()
        for link in self.parse_top(LexborHTMLParser(result.html), result.url):
            if link.url not in seen:
                seen.add(link.url)
                yield link.url

    async def scrape_series(self, url: str) -> IngestManhwa:
        result = await self._fetcher.fetch(url)
        document = LexborHTMLParser(result.html)
        series = self.parse_series(document, result.url)
        chapters = await self.collect_chapters(document, result.url)
        # Revalidation complète (et non `model_copy`) : la limite de 2 000 chapitres du contrat s'applique.
        return IngestManhwa.model_validate({**series.model_dump(), "chapters": chapters})

    async def collect_chapters(self, document: LexborHTMLParser, series_url: str) -> list[IngestChapter]:
        """Par défaut les chapitres sont sur la fiche ; à surcharger s'ils arrivent par une requête séparée."""
        return self.parse_chapters(document, series_url)

    # ---- Étapes propres à chaque CMS / site ----

    def parse_top(self, document: LexborHTMLParser, page_url: str) -> list[SeriesLink]:
        """Œuvres du « Top » de `top_page_url`. À surcharger avec `top_page_url` par les sources qui en ont un."""
        raise UnsupportedDiscoveryError(f"La source « {self.slug} » n'expose pas de Top")

    @abstractmethod
    def catalog_page_url(self, page: int) -> str:
        """URL de la page `page` (à partir de 1) du catalogue."""

    @abstractmethod
    def parse_catalog_page(self, document: LexborHTMLParser, page_url: str) -> list[str]:
        """URLs absolues des fiches listées sur une page du catalogue (liste vide = fin du catalogue)."""

    @abstractmethod
    def parse_series(self, document: LexborHTMLParser, series_url: str) -> IngestManhwa:
        """Métadonnées d'une fiche (sans ses chapitres). Lève `ExtractionError` si la structure est inattendue."""

    @abstractmethod
    def parse_chapters(self, document: LexborHTMLParser, series_url: str) -> list[IngestChapter]:
        """Chapitres listés dans `document` (fiche ou fragment AJAX)."""
