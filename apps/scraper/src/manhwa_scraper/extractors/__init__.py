"""Extracteurs : une classe abstraite (`SourceExtractor`), des thèmes par CMS, des sites concrets, un registre."""

from .base import ExtractionError, SeriesLink, SourceExtractor, UnsupportedDiscoveryError, UnsupportedSeriesError
from .registry import ExtractorRegistry, UnknownSourceError

__all__ = [
    "ExtractionError",
    "ExtractorRegistry",
    "SeriesLink",
    "SourceExtractor",
    "UnknownSourceError",
    "UnsupportedDiscoveryError",
    "UnsupportedSeriesError",
]
