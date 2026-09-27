"""Thème WordPress « MangaThemesia » (ex-« MangaStream » / MangaReader), second CMS le plus courant.

Même principe que Madara : un site déclare son URL et surcharge au besoin `selectors` / `series_path`.
"""

import logging
from abc import ABC
from dataclasses import dataclass
from typing import ClassVar

from selectolax.lexbor import LexborHTMLParser

from ...contract import IngestChapter, IngestManhwa
from ..base import ExtractionError, SourceExtractor
from ..parsing import absolute_url, clean_text, image_url, parse_chapter_number, parse_date, parse_status, parse_type

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class MangaThemesiaSelectors:
    catalog_link: str = ".listupd .bs .bsx a"
    title: str = "h1.entry-title"
    cover: str = ".thumb img"
    synopsis: str = ".entry-content[itemprop='description'], .synp .entry-content"
    info_item: str = ".tsinfo .imptdt"
    info_value: str = "i, a"
    chapter_item: str = "#chapterlist li"
    chapter_link: str = "a"
    chapter_label: str = ".chapternum"
    chapter_date: str = ".chapterdate"


class MangaThemesiaExtractor(SourceExtractor, ABC):
    selectors: ClassVar[MangaThemesiaSelectors] = MangaThemesiaSelectors()
    series_path: ClassVar[str] = "manga"

    def catalog_page_url(self, page: int) -> str:
        return f"{self.base_url}{self.series_path}/?page={page}&order=update"

    def parse_catalog_page(self, document: LexborHTMLParser, page_url: str) -> list[str]:
        urls: dict[str, None] = {}
        for link in document.css(self.selectors.catalog_link):
            href = link.attributes.get("href")
            if href:
                urls[absolute_url(page_url, href)] = None
        return list(urls)

    def parse_series(self, document: LexborHTMLParser, series_url: str) -> IngestManhwa:
        title = clean_text(document.css_first(self.selectors.title))
        if title is None:
            raise ExtractionError(f"Titre introuvable ({self.selectors.title}) sur {series_url}")
        return IngestManhwa(
            source_manhwa_url=series_url,
            title=title,
            synopsis=clean_text(document.css_first(self.selectors.synopsis)),
            cover_url=image_url(document.css_first(self.selectors.cover), series_url),
            status=parse_status(self._info_value(document, "statut", "status")),
            type=parse_type(self._info_value(document, "type")),
        )

    def parse_chapters(self, document: LexborHTMLParser, series_url: str) -> list[IngestChapter]:
        chapters: list[IngestChapter] = []
        for item in document.css(self.selectors.chapter_item):
            link = item.css_first(self.selectors.chapter_link)
            href = link.attributes.get("href") if link is not None else None
            label = clean_text(item.css_first(self.selectors.chapter_label))
            # `data-num` est la source la plus fiable ; le libellé sert de repli.
            raw_number = item.attributes.get("data-num") or label
            number = parse_chapter_number(raw_number) if raw_number else None
            if not href or number is None:
                logger.debug("Chapitre ignoré (lien ou numéro absent) sur %s : %r", series_url, label)
                continue
            chapters.append(
                IngestChapter(
                    number=number,
                    url=absolute_url(series_url, href),
                    language=self.language,
                    published_at=parse_date(clean_text(item.css_first(self.selectors.chapter_date))),
                )
            )
        return chapters

    def _info_value(self, document: LexborHTMLParser, *needles: str) -> str | None:
        """Lignes « Statut En cours » : le libellé est le texte de la ligne, la valeur son `<i>` / `<a>`."""
        for item in document.css(self.selectors.info_item):
            label = (clean_text(item) or "").lower()
            if any(needle in label for needle in needles):
                return clean_text(item.css_first(self.selectors.info_value))
        return None
