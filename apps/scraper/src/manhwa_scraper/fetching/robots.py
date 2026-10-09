"""Respect dynamique du `robots.txt` : chaque URL est vérifiée avant d'être demandée, quelle que soit la page.

Les règles sont lues sur le site lui-même (une fois par origine, puis gardées `ttl_s`) et interprétées selon la
RFC 9309 par Protego, le parseur de Scrapy : jokers `*` et `$`, règle la plus longue gagnante, groupes d'un même
User-Agent fusionnés. `urllib.robotparser` ne les gère qu'à partir de certaines versions correctives de Python :
une règle comme `Disallow: /*?m_orderby=` y passerait inaperçue selon la machine qui exécute le worker.

Cas où le fichier ne peut pas être lu (RFC 9309, § 2.3.1) :
- 4xx (absent, interdit) : « indisponible », tout est permis ;
- 5xx, 429, réseau : « injoignable », rien n'est permis ; on réessaie plus tôt (`error_ttl_s`) ;
- challenge anti-bot non franchi : `BlockedByAntiBotError` remonte et arrête le run, comme pour une page.
"""

import asyncio
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

from protego import Protego
from selectolax.lexbor import LexborHTMLParser

from .base import BlockedByAntiBotError, FetchError, FetchResult, HttpMethod, PageFetcher

logger = logging.getLogger(__name__)

USER_AGENT = "manhwa-scraper"
"""Jeton produit cherché dans `robots.txt` ; sans groupe à son nom, c'est le groupe `*` qui s'applique."""
DEFAULT_TTL_S = 24 * 3600  # durée de cache maximale recommandée par la RFC 9309
DEFAULT_ERROR_TTL_S = 10 * 60


class DisallowedByRobotsError(FetchError):
    """URL interdite par le `robots.txt` du site : elle n'a pas été demandée."""

    def __init__(self, url: str) -> None:
        super().__init__(f"{url} interdite par robots.txt", url=url)


@dataclass(frozen=True, slots=True)
class _Rules:
    parser: Protego | None
    """`None` = robots.txt injoignable : tout est interdit jusqu'à la prochaine lecture."""
    expires_at: float


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def _robots_text(result: FetchResult) -> str:
    """Texte brut du fichier. Un navigateur enveloppe le texte brut dans `<pre>` : on l'en extrait."""
    if not result.html.lstrip().startswith("<"):
        return result.html
    pre = LexborHTMLParser(result.html).css_first("pre")
    # Une page HTML sans `<pre>` (page d'erreur servie en 200) ne contient aucune règle : tout est permis.
    return pre.text() if pre is not None else ""


class RobotsPolicy:
    def __init__(
        self,
        fetcher: PageFetcher,
        *,
        user_agent: str = USER_AGENT,
        ttl_s: float = DEFAULT_TTL_S,
        error_ttl_s: float = DEFAULT_ERROR_TTL_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._fetcher = fetcher
        self._user_agent = user_agent
        self._ttl_s = ttl_s
        self._error_ttl_s = error_ttl_s
        self._clock = clock
        self._rules: dict[str, _Rules] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def allowed(self, url: str) -> bool:
        rules = await self._rules_for(_origin(url))
        return rules.parser is not None and rules.parser.can_fetch(url, self._user_agent)

    async def _rules_for(self, origin: str) -> _Rules:
        # Un verrou par origine : des requêtes concurrentes vers un site ne lisent son robots.txt qu'une fois.
        async with self._locks.setdefault(origin, asyncio.Lock()):
            rules = self._rules.get(origin)
            if rules is None or rules.expires_at <= self._clock():
                rules = self._rules[origin] = await self._load(origin)
            return rules

    async def _load(self, origin: str) -> _Rules:
        url = f"{origin}/robots.txt"
        try:
            result = await self._fetcher.fetch(url)
        except BlockedByAntiBotError:
            raise
        except FetchError as error:
            if error.status is not None and 400 <= error.status < 500 and error.status != 429:
                logger.info("%s indisponible (%s) : aucune restriction", url, error.status)
                return _Rules(Protego.parse(""), self._clock() + self._ttl_s)
            logger.warning("%s injoignable (%s) : site interdit jusqu'à la prochaine lecture", url, error)
            return _Rules(None, self._clock() + self._error_ttl_s)
        return _Rules(Protego.parse(_robots_text(result)), self._clock() + self._ttl_s)


class RobotsGuardedFetcher:
    """Décorateur de `PageFetcher` : refuse (`DisallowedByRobotsError`) toute URL que `robots.txt` interdit."""

    def __init__(self, inner: PageFetcher, policy: RobotsPolicy) -> None:
        self._inner = inner
        self._policy = policy

    async def fetch(
        self,
        url: str,
        *,
        method: HttpMethod = "GET",
        headers: Mapping[str, str] | None = None,
        data: Mapping[str, str] | None = None,
    ) -> FetchResult:
        if not await self._policy.allowed(url):
            raise DisallowedByRobotsError(url)
        return await self._inner.fetch(url, method=method, headers=headers, data=data)
