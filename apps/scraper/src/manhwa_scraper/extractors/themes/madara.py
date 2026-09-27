"""Thème WordPress « Madara » (WP-Manga), le CMS le plus répandu chez les teams de scantrad.

Chaque site peut surcharger `selectors` (thème enfant) ou `series_path` (slug des fiches : `manga`,
`oeuvre`, `webtoon`…) sans réécrire la logique d'extraction.
"""

import logging
from abc import ABC
from dataclasses import dataclass
from typing import ClassVar

from selectolax.lexbor import LexborHTMLParser, LexborNode

from ...models import ScrapedChapter, SeriesMetadata
from ..base import ExtractionError, SourceExtractor
from ..parsing import absolute_url, clean_text, image_url, parse_chapter_number, parse_date, parse_status, parse_type

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class MadaraSelectors:
    catalog_link: str = ".page-item-detail .post-title a, .c-tabs-item__content .post-title a"
    title: str = ".post-title h1"
    cover: str = ".summary_image img"
    synopsis: str = ".summary__content, .manga-excerpt"
    info_item: str = ".post-content_item"
    info_label: str = ".summary-heading"
    info_value: str = ".summary-content"
    chapter_item: str = "li.wp-manga-chapter"
    chapter_link: str = "a"
    chapter_date: str = ".chapter-release-date"


class MadaraExtractor(SourceExtractor, ABC):
    selectors: ClassVar[MadaraSelectors] = MadaraSelectors()
    series_path: ClassVar[str] = "manga"

    def catalog_page_url(self, page: int) -> str:
        pagination = "" if page == 1 else f"page/{page}/"
        return f"{self.base_url}{self.series_path}/{pagination}?m_orderby=latest"

    def parse_catalog_page(self, document: LexborHTMLParser, page_url: str) -> list[str]:
        urls: dict[str, None] = {}  # dict = ensemble ordonné
        for link in document.css(self.selectors.catalog_link):
            href = link.attributes.get("href")
            if href:
                urls[absolute_url(page_url, href)] = None
        return list(urls)

    def parse_series(self, document: LexborHTMLParser, series_url: str) -> SeriesMetadata:
        title = clean_text(document.css_first(self.selectors.title))
        if title is None:
            raise ExtractionError(f"Titre introuvable ({self.selectors.title}) sur {series_url}")
        info = self._info_table(document)
        return SeriesMetadata(
            source_manhwa_url=series_url,
            title=title,
            synopsis=clean_text(document.css_first(self.selectors.synopsis)),
            cover_url=image_url(document.css_first(self.selectors.cover), series_url),
            status=parse_status(_first_value(info, "statut", "status")),
            type=parse_type(_first_value(info, "type")),
        )

    async def collect_chapters(self, document: LexborHTMLParser, series_url: str) -> list[ScrapedChapter]:
        chapters = self.parse_chapters(document, series_url)
        if chapters:
            return chapters
        # Madara récent : la liste n'est pas dans la fiche mais servie par `<fiche>/ajax/chapters/` (POST).
        result = await self._fetcher.fetch(
            f"{series_url.rstrip('/')}/ajax/chapters/",
            method="POST",
            headers={"X-Requested-With": "XMLHttpRequest", "Referer": series_url},
        )
        return self.parse_chapters(LexborHTMLParser(result.html), series_url)

    def parse_chapters(self, document: LexborHTMLParser, series_url: str) -> list[ScrapedChapter]:
        chapters: list[ScrapedChapter] = []
        for item in document.css(self.selectors.chapter_item):
            link = item.css_first(self.selectors.chapter_link)
            href = link.attributes.get("href") if link is not None else None
            label = clean_text(link)
            number = parse_chapter_number(label) if label else None
            if not href or label is None or number is None:
                logger.debug("Chapitre ignoré (lien ou numéro absent) sur %s : %r", series_url, label)
                continue
            chapters.append(
                ScrapedChapter(
                    number=number,
                    url=absolute_url(series_url, href),
                    language=self.language,
                    title=_chapter_title(label),
                    published_at=parse_date(_release_date_label(item.css_first(self.selectors.chapter_date))),
                )
            )
        return chapters

    def _info_table(self, document: LexborHTMLParser) -> dict[str, str]:
        """Bloc « Statut / Type / Genres… » de la fiche, sous forme `libellé en minuscules → valeur`."""
        info: dict[str, str] = {}
        for item in document.css(self.selectors.info_item):
            label = clean_text(item.css_first(self.selectors.info_label))
            value = clean_text(item.css_first(self.selectors.info_value))
            if label and value:
                info[label.lower()] = value
        return info


def _first_value(info: dict[str, str], *needles: str) -> str | None:
    for label, value in info.items():
        if any(needle in label for needle in needles):
            return value
    return None


def _chapter_title(label: str) -> str | None:
    """« Chapitre 12 - Le retour » → « Le retour »."""
    for separator in (" - ", " – ", " : "):
        if separator in label:
            return label.split(separator, 1)[1].strip() or None
    return None


def _release_date_label(node: LexborNode | None) -> str | None:
    """Les chapitres récents affichent un badge « NEW » : la date relative est alors dans `title`."""
    if node is None:
        return None
    text = clean_text(node)
    if text:
        return text
    badge = node.css_first("a[title]")
    return badge.attributes.get("title") if badge is not None else None
