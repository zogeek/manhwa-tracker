"""scan-manga.com — site PHP propriétaire (ni Madara ni MangaThemesia).

Relevé du 2026-09-27 : un client HTTP classique reçoit un 403 Cloudflare, l'empreinte TLS de Chrome
(étage curl_cffi) passe sans navigateur. Extracteur sur mesure à écrire.
"""

from typing import ClassVar

from selectolax.lexbor import LexborHTMLParser

from ...models import ScrapedChapter, SeriesMetadata
from ..base import SourceExtractor


class ScanMangaExtractor(SourceExtractor):
    slug: ClassVar[str] = "scan-manga"
    name: ClassVar[str] = "Scan-Manga"
    base_url: ClassVar[str] = "https://scan-manga.com/"

    def catalog_page_url(self, page: int) -> str:
        raise NotImplementedError(f"{self.slug} : pagination du catalogue à implémenter")

    def parse_catalog_page(self, document: LexborHTMLParser, page_url: str) -> list[str]:
        raise NotImplementedError(f"{self.slug} : liens des fiches du catalogue à implémenter")

    def parse_series(self, document: LexborHTMLParser, series_url: str) -> SeriesMetadata:
        raise NotImplementedError(f"{self.slug} : lecture de la fiche à implémenter")

    def parse_chapters(self, document: LexborHTMLParser, series_url: str) -> list[ScrapedChapter]:
        raise NotImplementedError(f"{self.slug} : liste des chapitres à implémenter")
