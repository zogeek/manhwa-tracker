"""rimuscan.fr — application Next.js sur mesure (Rimu Scans).

Relevé du 2026-09-27 : servi derrière Cloudflare mais sans challenge, l'étage HTTP suffit.
Même piste qu'Astral Manga : privilégier les données JSON embarquées par Next.js au HTML rendu.
"""

from typing import ClassVar

from selectolax.lexbor import LexborHTMLParser

from ...contract import IngestChapter, IngestManhwa
from ..base import SourceExtractor


class RimuScanExtractor(SourceExtractor):
    slug: ClassVar[str] = "rimuscan"
    name: ClassVar[str] = "Rimu Scans"
    base_url: ClassVar[str] = "https://rimuscan.fr/"

    def catalog_page_url(self, page: int) -> str:
        raise NotImplementedError(f"{self.slug} : pagination du catalogue à implémenter")

    def parse_catalog_page(self, document: LexborHTMLParser, page_url: str) -> list[str]:
        raise NotImplementedError(f"{self.slug} : liens des fiches du catalogue à implémenter")

    def parse_series(self, document: LexborHTMLParser, series_url: str) -> IngestManhwa:
        raise NotImplementedError(f"{self.slug} : lecture de la fiche à implémenter")

    def parse_chapters(self, document: LexborHTMLParser, series_url: str) -> list[IngestChapter]:
        raise NotImplementedError(f"{self.slug} : liste des chapitres à implémenter")
