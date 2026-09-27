"""Extracteurs : une classe abstraite (`SourceExtractor`), des thèmes par CMS, des sites concrets, un registre."""

from .base import ExtractionError, SourceExtractor
from .registry import ExtractorRegistry, UnknownSourceError

__all__ = ["ExtractionError", "ExtractorRegistry", "SourceExtractor", "UnknownSourceError"]
