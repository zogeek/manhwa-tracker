"""Doublures de test partagées : aucun test ne touche au réseau ni ne lance de navigateur."""

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from manhwa_scraper.fetching import BlockedByAntiBotError, FetchError, FetchResult, HttpMethod
from manhwa_scraper.fetching.base import FetchTier

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@dataclass(frozen=True, slots=True)
class FetchCall:
    url: str
    method: HttpMethod
    headers: Mapping[str, str] | None
    data: Mapping[str, str] | None = None


@dataclass
class FakeFetcher:
    """Répond depuis une table `(méthode, URL) → HTML | exception` et journalise les appels."""

    pages: dict[tuple[HttpMethod, str], str | FetchError] = field(default_factory=dict)
    tier: FetchTier = "http"
    calls: list[FetchCall] = field(default_factory=list)

    def add(self, url: str, body: str | FetchError, *, method: HttpMethod = "GET") -> None:
        self.pages[(method, url)] = body

    async def fetch(
        self,
        url: str,
        *,
        method: HttpMethod = "GET",
        headers: Mapping[str, str] | None = None,
        data: Mapping[str, str] | None = None,
    ) -> FetchResult:
        self.calls.append(FetchCall(url, method, headers, data))
        body = self.pages.get((method, url))
        if body is None:
            raise FetchError(f"{method} {url} -> 404", url=url, status=404)
        if isinstance(body, FetchError):
            raise body
        return FetchResult(url=url, status=200, html=body, latency_ms=1, tier=self.tier)


def blocked(url: str) -> BlockedByAntiBotError:
    return BlockedByAntiBotError(url=url, status=403, blocked_by="cloudflare")


@dataclass
class FakeIngestApi:
    """Faux serveur `/api/ingest/*` branché sur `httpx.MockTransport` : même contrat HTTP que l'API Hono."""

    run_id: str = "5b8f2c1e-0000-4000-8000-000000000001"
    batch_failures: list[int] = field(default_factory=list)
    """Statuts renvoyés (dans l'ordre) par les premiers POST /batches avant de réussir."""
    tracked: list[dict[str, Any]] = field(default_factory=list)
    """Séries servies par GET /tracked (JSON du contrat), paginées comme l'API : tri et curseur sur `manhwaId`."""
    requests: list[httpx.Request] = field(default_factory=list)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def bodies(self, method: str, path: str) -> list[dict[str, Any]]:
        """Corps JSON reçus (non typés par nature : c'est justement ce que les tests vérifient)."""
        return [json.loads(r.content) for r in self.requests if r.method == method and r.url.path == path]

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.headers.get("x-api-key") != "k" * 32:
            return httpx.Response(401, json={"error": "Unauthorized"})
        path, method = request.url.path, request.method
        if (method, path) == ("POST", "/api/ingest/runs"):
            return httpx.Response(201, json={"data": {"id": self.run_id, "status": "running"}})
        if method == "PATCH" and path.startswith("/api/ingest/runs/"):
            status = json.loads(request.content)["status"]
            return httpx.Response(200, json={"data": {"id": self.run_id, "status": status}})
        if (method, path) == ("POST", "/api/ingest/batches"):
            if self.batch_failures:
                return httpx.Response(self.batch_failures.pop(0), json={"error": "boom"})
            result = {"manhwas": [], "chaptersCreated": 2, "releasesCreated": 2, "releasesUpdated": 0, "coversAdded": 1}
            return httpx.Response(201, json={"data": result})
        if (method, path) == ("GET", "/api/ingest/tracked"):
            return self._tracked_page(request.url.params)
        if (method, path) == ("POST", "/api/ingest/health"):
            return httpx.Response(201, json={"data": {"recorded": len(json.loads(request.content)["samples"])}})
        return httpx.Response(404, json={"error": "Not found"})

    def _tracked_page(self, params: httpx.QueryParams) -> httpx.Response:
        cursor, limit = params.get("cursor"), int(params.get("limit", "100"))
        rows = sorted(self.tracked, key=lambda series: str(series["manhwaId"]))
        after = [series for series in rows if cursor is None or str(series["manhwaId"]) > cursor]
        data = after[:limit]
        next_cursor = data[-1]["manhwaId"] if len(after) > limit else None
        return httpx.Response(200, json={"data": data, "nextCursor": next_cursor})


def tracked_series(manhwa_id: str, title: str, manhwa_url: str | None = None) -> dict[str, Any]:
    """Une ligne de GET /tracked, telle que l'API la renvoie."""
    return {
        "manhwaId": manhwa_id,
        "title": title,
        "manhwaUrl": manhwa_url,
        "latestChapter": None,
        "lastScrapedAt": None,
    }


async def no_sleep(_: float) -> None:
    return None
