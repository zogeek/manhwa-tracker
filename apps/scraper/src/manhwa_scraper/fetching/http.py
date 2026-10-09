"""Étage rapide : requêtes HTTP avec l'empreinte TLS/HTTP2 d'un vrai Chrome (curl_cffi).

Beaucoup de protections (Cloudflare « Bot Fight », WAF de scan-manga.com…) rejettent un client
Python sur sa seule poignée de main TLS (empreinte JA3/JA4), avant même de lire la requête.
curl_cffi rejoue celle de Chrome : ~100 ms par page au lieu de plusieurs secondes pour un navigateur.
"""

import time
from collections.abc import Mapping
from types import TracebackType
from typing import Self

from curl_cffi.requests import AsyncSession, BrowserTypeLiteral, Response
from curl_cffi.requests.exceptions import RequestException

from .base import BlockedByAntiBotError, FetchError, FetchResult, HttpMethod, detect_challenge, form_body


class CurlCffiFetcher:
    def __init__(self, *, impersonate: BrowserTypeLiteral = "chrome", timeout_s: float = 30.0) -> None:
        self._session: AsyncSession[Response] = AsyncSession(
            impersonate=impersonate,
            timeout=timeout_s,
            headers={"Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"},
        )

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self._session.close()

    async def fetch(
        self,
        url: str,
        *,
        method: HttpMethod = "GET",
        headers: Mapping[str, str] | None = None,
        data: Mapping[str, str] | None = None,
    ) -> FetchResult:
        request_headers, body = form_body(headers, data)
        started = time.perf_counter()
        try:
            response = await self._session.request(method, url, headers=request_headers, data=body)
        except RequestException as error:
            raise FetchError(f"{method} {url} : {error}", url=url) from error
        latency_ms = round((time.perf_counter() - started) * 1000)

        html = response.text
        blocked_by = detect_challenge(html)
        if blocked_by is not None:
            raise BlockedByAntiBotError(url=url, status=response.status_code, blocked_by=blocked_by)
        if response.status_code >= 400:
            raise FetchError(f"{method} {url} -> {response.status_code}", url=url, status=response.status_code)
        return FetchResult(
            url=str(response.url), status=response.status_code, html=html, latency_ms=latency_ms, tier="http"
        )
