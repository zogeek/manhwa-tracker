"""Registre des sources (pattern Factory) : du slug ou de l'URL à l'extracteur prêt à l'emploi."""

from collections.abc import Iterable

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

    def create(self, slug: str, fetcher: PageFetcher) -> SourceExtractor:
        return self.get(slug)(fetcher)
