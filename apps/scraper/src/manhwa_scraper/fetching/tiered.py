"""Décorateurs de `PageFetcher` : escalade HTTP → navigateur, et politesse (débit limité par site)."""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from urllib.parse import urlsplit

from .base import BlockedByAntiBotError, FetchResult, HttpMethod, PageFetcher

logger = logging.getLogger(__name__)


def _host(url: str) -> str:
    return urlsplit(url).hostname or url


class TieredFetcher:
    """Tente l'étage rapide, bascule sur le navigateur au premier challenge anti-bot.

    La bascule est mémorisée par site pour le reste du run : inutile de reperdre une requête
    (et d'attirer l'attention du WAF) sur chaque page d'un site dont on sait qu'il exige un navigateur.
    """

    def __init__(self, fast: PageFetcher, browser: PageFetcher) -> None:
        self._fast = fast
        self._browser = browser
        self._escalated: set[str] = set()

    async def fetch(
        self,
        url: str,
        *,
        method: HttpMethod = "GET",
        headers: Mapping[str, str] | None = None,
    ) -> FetchResult:
        host = _host(url)
        if host not in self._escalated:
            try:
                return await self._fast.fetch(url, method=method, headers=headers)
            except BlockedByAntiBotError as error:
                logger.info("%s protégé par %s : bascule sur le navigateur", host, error.blocked_by)
                self._escalated.add(host)
        return await self._browser.fetch(url, method=method, headers=headers)


class ThrottledFetcher:
    """Garantit un intervalle minimal entre deux requêtes vers un même site (anti-ban, respect des sources)."""

    def __init__(
        self,
        inner: PageFetcher,
        *,
        min_interval_s: float,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._inner = inner
        self._min_interval_s = min_interval_s
        self._clock = clock
        self._sleep = sleep
        self._last_request: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def fetch(
        self,
        url: str,
        *,
        method: HttpMethod = "GET",
        headers: Mapping[str, str] | None = None,
    ) -> FetchResult:
        host = _host(url)
        async with self._locks.setdefault(host, asyncio.Lock()):
            last = self._last_request.get(host)
            if last is not None:
                wait = self._min_interval_s - (self._clock() - last)
                if wait > 0:
                    await self._sleep(wait)
            try:
                return await self._inner.fetch(url, method=method, headers=headers)
            finally:
                self._last_request[host] = self._clock()
