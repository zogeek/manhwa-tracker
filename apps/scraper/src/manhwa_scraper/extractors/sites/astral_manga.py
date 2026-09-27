"""astral-manga.fr — application Next.js sur mesure, derrière un challenge Cloudflare JavaScript.

Relevé du 2026-09-27 : curl_cffi est bloqué (403 « Un instant… ») → l'étage navigateur (Camoufox)
est indispensable, et il passe. Piste : les pages Next.js embarquent souvent leurs données en JSON
(`__NEXT_DATA__` ou flux RSC) — plus stable à lire que le HTML rendu.
"""

from typing import ClassVar

from selectolax.lexbor import LexborHTMLParser

from ...models import ScrapedChapter, SeriesMetadata
from ..base import SourceExtractor


class AstralMangaExtractor(SourceExtractor):
    slug: ClassVar[str] = "astral-manga"
    name: ClassVar[str] = "Astral Manga"
    base_url: ClassVar[str] = "https://astral-manga.fr/"

    def catalog_page_url(self, page: int) -> str:
        raise NotImplementedError(f"{self.slug} : pagination du catalogue à implémenter")

    def parse_catalog_page(self, document: LexborHTMLParser, page_url: str) -> list[str]:
        raise NotImplementedError(f"{self.slug} : liens des fiches du catalogue à implémenter")

    def parse_series(self, document: LexborHTMLParser, series_url: str) -> SeriesMetadata:
        raise NotImplementedError(f"{self.slug} : lecture de la fiche à implémenter")

    def parse_chapters(self, document: LexborHTMLParser, series_url: str) -> list[ScrapedChapter]:
        raise NotImplementedError(f"{self.slug} : liste des chapitres à implémenter")
