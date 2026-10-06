"""Registre des sources (pattern Factory) : du slug ou de l'URL à l'extracteur prêt à l'emploi."""

from collections.abc import Iterable, Sequence

from ..fetching import PageFetcher
from .base import SourceExtractor


class UnknownSourceError(LookupError):
    pass


class ExtractorRegistry:
    def __init__(self, extractors: Iterable[type[SourceExtractor]]) -> None:
        self._by_slug: dict[str, type[SourceExtractor]] = {}
        for extractor in extractors:
            if extractor.slug in self._by_slug:
                raise ValueError(f"Slug de source en double : {extractor.slug}")
            self._by_slug[extractor.slug] = extractor

    def all(self) -> list[type[SourceExtractor]]:
        return sorted(self._by_slug.values(), key=lambda extractor: extractor.slug)

    def get(self, slug: str) -> type[SourceExtractor]:
        try:
            return self._by_slug[slug]
        except KeyError:
            known = ", ".join(sorted(self._by_slug))
            raise UnknownSourceError(f"Source inconnue « {slug} » (disponibles : {known})") from None

    def for_url(self, url: str) -> type[SourceExtractor]:
        for extractor in self._by_slug.values():
            if extractor.handles(url):
                return extractor
        raise UnknownSourceError(f"Aucune source ne gère {url}")

    def for_urls(self, urls: Sequence[str]) -> type[SourceExtractor]:
        """Source commune à toutes les `urls` (un run = une source : il est rattaché à une ligne de `sources`)."""
        if not urls:
            raise UnknownSourceError("Aucune URL fournie")
        by_source: dict[type[SourceExtractor], list[str]] = {}
        for url in urls:
            by_source.setdefault(self.for_url(url), []).append(url)
        if len(by_source) > 1:
            detail = " ; ".join(f"{extractor.slug} : {len(found)} URL(s)" for extractor, found in by_source.items())
            raise UnknownSourceError(f"Les URLs doivent toutes appartenir à la même source ({detail})")
        return next(iter(by_source))

    def create(self, slug: str, fetcher: PageFetcher) -> SourceExtractor:
        return self.get(slug)(fetcher)
