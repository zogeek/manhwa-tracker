"""Contrat commun des « fetchers » : récupérer le HTML final d'une URL, quel que soit le moyen employé.

Les extracteurs ne dépendent que du protocole `PageFetcher` : en test on injecte un faux fetcher
qui renvoie du HTML figé, sans navigateur ni réseau.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, Protocol
from urllib.parse import urlencode

HttpMethod = Literal["GET", "POST"]
FetchTier = Literal["http", "browser"]


@dataclass(frozen=True, slots=True)
class FetchResult:
    url: str
    """URL finale, après redirections : c'est elle qui sert de base aux liens relatifs."""
    status: int
    html: str
    latency_ms: int
    tier: FetchTier


class PageFetcher(Protocol):
    async def fetch(
        self,
        url: str,
        *,
        method: HttpMethod = "GET",
        headers: Mapping[str, str] | None = None,
        data: Mapping[str, str] | None = None,
    ) -> FetchResult:
        """HTML de la page, après les éventuels challenges anti-bot. Lève une `FetchError` sinon.

        `data` : champs d'un formulaire envoyés en corps de requête (POST AJAX), encodés par `form_body`.
        """
        ...


FORM_CONTENT_TYPE = "application/x-www-form-urlencoded"


def form_body(headers: Mapping[str, str] | None, data: Mapping[str, str] | None) -> tuple[dict[str, str], str | None]:
    """En-têtes et corps d'une requête : `data` encodé en formulaire, `Content-Type` ajouté s'il manque."""
    merged = dict(headers or {})
    if data is None:
        return merged, None
    if not any(name.lower() == "content-type" for name in merged):
        merged["Content-Type"] = FORM_CONTENT_TYPE
    return merged, urlencode(data)


class FetchError(RuntimeError):
    """Échec de récupération (réseau, statut HTTP d'erreur) : l'œuvre est ignorée, le run continue."""

    def __init__(self, message: str, *, url: str, status: int | None = None) -> None:
        super().__init__(message)
        self.url = url
        self.status = status


class BlockedByAntiBotError(FetchError):
    """Challenge anti-bot non franchi. Remonté jusqu'au run (→ `source_health.status = blocked`)."""

    def __init__(self, *, url: str, status: int | None, blocked_by: str) -> None:
        super().__init__(f"Bloqué par {blocked_by} sur {url}", url=url, status=status)
        self.blocked_by = blocked_by


_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
# Titres des pages d'attente pendant l'exécution du challenge JavaScript (Cloudflare localise le sien).
_CHALLENGE_TITLES: dict[str, str] = {
    "just a moment": "cloudflare",
    "un instant": "cloudflare",
    "attention required": "cloudflare",
    "ddos-guard": "ddos-guard",
}
# Marqueurs présents uniquement sur les pages de challenge (pas sur les pages protégées déjà franchies,
# qui chargent aussi `/cdn-cgi/challenge-platform/…` : ce script-là ne suffit pas à conclure).
_CHALLENGE_MARKERS: dict[str, str] = {
    "_cf_chl_opt": "cloudflare",
    "ddos-guard.net/": "ddos-guard",
}
CHALLENGE_TITLES: tuple[str, ...] = tuple(_CHALLENGE_TITLES)


def detect_challenge(html: str) -> str | None:
    """Nom de la protection si `html` est une page de challenge anti-bot, sinon `None`."""
    head = html[:20_000]
    match = _TITLE_RE.search(head)
    if match is not None:
        title = match.group(1).strip().lower()
        for needle, vendor in _CHALLENGE_TITLES.items():
            if needle in title:
                return vendor
    for marker, vendor in _CHALLENGE_MARKERS.items():
        if marker in head:
            return vendor
    return None
