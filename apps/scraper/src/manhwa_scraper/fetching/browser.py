"""Étage lourd : un vrai navigateur anti-détection (Camoufox, Firefox modifié) pour les challenges JavaScript.

Camoufox falsifie l'empreinte au niveau C++ du moteur (canvas, WebGL, polices, `navigator`…), là où
les « stealth plugins » Chromium ne font que masquer des propriétés en JavaScript — ce que Cloudflare
Turnstile détecte. Mesuré sur astral-manga.fr : Chromium (même patché) reste bloqué, Camoufox passe.

Le navigateur n'est lancé qu'au premier besoin : un run qui ne tombe jamais sur un challenge ne le paie pas.
"""

import asyncio
import time
from collections.abc import Mapping
from contextlib import suppress
from types import TracebackType
from typing import Self

from camoufox.async_api import AsyncNewBrowser
from playwright.async_api import Browser, BrowserContext, Playwright, Response, async_playwright
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from .base import CHALLENGE_TITLES, BlockedByAntiBotError, FetchError, FetchResult, HttpMethod, detect_challenge


class CamoufoxFetcher:
    """Un navigateur et un contexte pour tout le run : les cookies de challenge (cf_clearance) sont réutilisés."""

    def __init__(self, *, headless: bool = True, timeout_ms: int = 45_000) -> None:
        self._headless = headless
        self._timeout_ms = timeout_ms
        self._lock = asyncio.Lock()
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self._context is not None:
            await self._context.close()
        if self._browser is not None:
            await self._browser.close()
        if self._playwright is not None:
            await self._playwright.stop()

    async def _ensure_context(self) -> BrowserContext:
        async with self._lock:
            if self._context is None:
                self._playwright = await async_playwright().start()
                self._browser = await AsyncNewBrowser(self._playwright, headless=self._headless, locale="fr-FR")
                self._context = await self._browser.new_context()
            return self._context

    async def fetch(
        self,
        url: str,
        *,
        method: HttpMethod = "GET",
        headers: Mapping[str, str] | None = None,
    ) -> FetchResult:
        context = await self._ensure_context()
        started = time.perf_counter()
        try:
            if method == "POST":
                # Appels AJAX (ex. liste de chapitres Madara) : même jar de cookies que les pages déjà franchies.
                api_response = await context.request.post(url, headers=dict(headers or {}), timeout=self._timeout_ms)
                status, html, final_url = api_response.status, await api_response.text(), api_response.url
            else:
                status, html, final_url = await self._navigate(context, url, headers)
        except PlaywrightError as error:
            raise FetchError(f"{method} {url} : {error.message}", url=url) from error
        latency_ms = round((time.perf_counter() - started) * 1000)

        blocked_by = detect_challenge(html)
        if blocked_by is not None:
            raise BlockedByAntiBotError(url=url, status=status, blocked_by=blocked_by)
        if status >= 400:
            raise FetchError(f"{method} {url} -> {status}", url=url, status=status)
        return FetchResult(url=final_url, status=status, html=html, latency_ms=latency_ms, tier="browser")

    async def _navigate(
        self, context: BrowserContext, url: str, headers: Mapping[str, str] | None
    ) -> tuple[int, str, str]:
        page = await context.new_page()
        # Statut du dernier document chargé : une fois le challenge résolu, la page se recharge et le 403
        # initial (celui de la page d'attente) ne reflète plus rien.
        statuses: list[int] = []

        def on_response(response: Response) -> None:
            if response.request.is_navigation_request() and response.frame == page.main_frame:
                statuses.append(response.status)

        page.on("response", on_response)
        try:
            if headers:
                await page.set_extra_http_headers(dict(headers))
            await page.goto(url, wait_until="domcontentloaded", timeout=self._timeout_ms)
            # Le challenge recharge la page une fois résolu : on attend que son titre d'attente disparaisse.
            # En cas d'expiration, `detect_challenge` sur le HTML final tranchera (→ BlockedByAntiBotError).
            with suppress(PlaywrightTimeoutError):
                await page.wait_for_function(
                    "titles => !titles.some(t => document.title.toLowerCase().includes(t))",
                    arg=list(CHALLENGE_TITLES),
                    timeout=self._timeout_ms,
                )
            # Laisse les listes chargées en JS (AJAX, hydratation Next.js) arriver dans le DOM ;
            # des traqueurs qui ne se taisent jamais ne doivent pas faire échouer la page.
            with suppress(PlaywrightTimeoutError):
                await page.wait_for_load_state("networkidle", timeout=self._timeout_ms)
            return (statuses[-1] if statuses else 200), await page.content(), page.url
        finally:
            await page.close()
