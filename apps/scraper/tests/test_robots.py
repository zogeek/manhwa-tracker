"""robots.txt dynamique : règles RFC 9309, cache par origine, et comportement quand le fichier est illisible."""

import asyncio

import pytest

from manhwa_scraper.fetching import (
    BlockedByAntiBotError,
    DisallowedByRobotsError,
    FetchError,
    RobotsGuardedFetcher,
    RobotsPolicy,
)

from .fakes import FakeFetcher, blocked, fixture

ROBOTS = "https://scan.test/robots.txt"
PAGE = "https://scan.test/manga/solo/"
SCAN_MANGA_ROBOTS = "https://www.scan-manga.com/robots.txt"


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def robots_calls(fetcher: FakeFetcher) -> int:
    return sum(call.url.endswith("/robots.txt") for call in fetcher.calls)


class TestRules:
    async def test_scan_manga_merges_its_two_generic_groups(self) -> None:
        """Copie du fichier du site (relevé du 2026-10-09) : deux groupes `User-Agent: *`, à fusionner."""
        fetcher = FakeFetcher()
        fetcher.add(SCAN_MANGA_ROBOTS, fixture("robots_scan_manga.txt"))
        policy = RobotsPolicy(fetcher)

        assert await policy.allowed("https://www.scan-manga.com/17231/La-Tour-Sans-Fin.html")
        assert not await policy.allowed("https://www.scan-manga.com/search.php?q=solo")  # `/*.php?*`, 2ᵉ groupe

    async def test_a_group_named_after_another_bot_does_not_apply_to_us(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(SCAN_MANGA_ROBOTS, fixture("robots_scan_manga.txt"))

        assert await RobotsPolicy(fetcher).allowed("https://www.scan-manga.com/")
        assert not await RobotsPolicy(fetcher, user_agent="ClaudeBot").allowed("https://www.scan-manga.com/")

    async def test_a_group_named_after_us_wins_over_the_generic_one(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, "User-agent: *\nDisallow:\n\nUser-agent: manhwa-scraper\nDisallow: /manga/\n")

        assert not await RobotsPolicy(fetcher).allowed(PAGE)

    async def test_the_longest_rule_wins(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, "User-agent: *\nDisallow: /manga/\nAllow: /manga/solo/\n")
        policy = RobotsPolicy(fetcher)

        assert await policy.allowed(PAGE)
        assert not await policy.allowed("https://scan.test/manga/necro/")

    async def test_reads_the_text_a_browser_wraps_in_pre(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, "<html><head></head><body><pre>User-agent: *\nDisallow: /manga/\n</pre></body></html>")

        assert not await RobotsPolicy(fetcher).allowed(PAGE)

    async def test_an_html_page_without_rules_allows_everything(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, "<html><body><h1>Page introuvable</h1></body></html>")

        assert await RobotsPolicy(fetcher).allowed(PAGE)


class TestUnreadableFile:
    @pytest.mark.parametrize("status", [401, 403, 404, 410])
    async def test_an_unavailable_file_allows_everything(self, status: int) -> None:
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, FetchError("absent", url=ROBOTS, status=status))

        assert await RobotsPolicy(fetcher).allowed(PAGE)

    @pytest.mark.parametrize("status", [429, 500, 503, None])
    async def test_an_unreachable_file_forbids_everything_and_is_read_again_sooner(self, status: int | None) -> None:
        clock = Clock()
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, FetchError("panne", url=ROBOTS, status=status))
        policy = RobotsPolicy(fetcher, ttl_s=3600, error_ttl_s=60, clock=clock)

        assert not await policy.allowed(PAGE)
        fetcher.add(ROBOTS, "User-agent: *\nDisallow:\n")
        clock.now = 61

        assert await policy.allowed(PAGE)
        assert robots_calls(fetcher) == 2

    async def test_an_anti_bot_block_stops_the_run(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, blocked(ROBOTS))

        with pytest.raises(BlockedByAntiBotError):
            await RobotsPolicy(fetcher).allowed(PAGE)


class TestCache:
    async def test_reads_the_file_once_per_origin_until_it_expires(self) -> None:
        clock = Clock()
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, "User-agent: *\nDisallow:\n")
        policy = RobotsPolicy(fetcher, ttl_s=3600, clock=clock)

        assert await policy.allowed(PAGE)
        assert await policy.allowed("https://scan.test/manga/necro/")
        assert robots_calls(fetcher) == 1

        fetcher.add(ROBOTS, "User-agent: *\nDisallow: /\n")  # le site change d'avis
        clock.now = 3600

        assert not await policy.allowed(PAGE)
        assert robots_calls(fetcher) == 2

    async def test_concurrent_requests_share_a_single_read(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, "User-agent: *\nDisallow:\n")
        policy = RobotsPolicy(fetcher)

        await asyncio.gather(*(policy.allowed(PAGE) for _ in range(5)))

        assert robots_calls(fetcher) == 1

    async def test_each_origin_has_its_own_rules(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, "User-agent: *\nDisallow: /\n")
        fetcher.add("https://autre.test/robots.txt", "User-agent: *\nDisallow:\n")
        policy = RobotsPolicy(fetcher)

        assert not await policy.allowed(PAGE)
        assert await policy.allowed("https://autre.test/manga/solo/")


class TestGuard:
    async def test_a_forbidden_url_is_never_requested(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, "User-agent: *\nDisallow: /manga/\n")
        fetcher.add(PAGE, "<html></html>")

        with pytest.raises(DisallowedByRobotsError):
            await RobotsGuardedFetcher(fetcher, RobotsPolicy(fetcher)).fetch(PAGE)

        assert [call.url for call in fetcher.calls] == [ROBOTS]

    async def test_an_allowed_url_goes_through_with_its_method_and_headers(self) -> None:
        fetcher = FakeFetcher()
        fetcher.add(ROBOTS, "User-agent: *\nDisallow: /wp-admin/\n")
        fetcher.add(f"{PAGE}ajax/chapters/", "<ul></ul>", method="POST")

        result = await RobotsGuardedFetcher(fetcher, RobotsPolicy(fetcher)).fetch(
            f"{PAGE}ajax/chapters/", method="POST", headers={"X-Requested-With": "XMLHttpRequest"}
        )

        assert result.html == "<ul></ul>"
        assert fetcher.calls[-1].headers == {"X-Requested-With": "XMLHttpRequest"}
