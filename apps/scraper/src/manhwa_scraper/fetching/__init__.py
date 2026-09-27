"""Récupération des pages. Les implémentations lourdes (navigateur) ne sont importées que par la composition root."""

from .base import BlockedByAntiBotError, FetchError, FetchResult, HttpMethod, PageFetcher, detect_challenge
from .tiered import ThrottledFetcher, TieredFetcher

__all__ = [
    "BlockedByAntiBotError",
    "FetchError",
    "FetchResult",
    "HttpMethod",
    "PageFetcher",
    "ThrottledFetcher",
    "TieredFetcher",
    "detect_challenge",
]
