import pytest

from manhwa_scraper.fetching import BlockedByAntiBotError, ThrottledFetcher, TieredFetcher, detect_challenge

from .fakes import FakeFetcher, blocked, fixture

URL_A = "https://protected.test/manga/a/"
URL_B = "https://protected.test/manga/b/"


class TestDetectChallenge:
    def test_detects_localized_cloudflare_waiting_page(self) -> None:
        assert detect_challenge(fixture("cloudflare_challenge.html")) == "cloudflare"

    def test_detects_ddos_guard(self) -> None:
        assert detect_challenge("<html><head><title>DDoS-Guard</title></head></html>") == "ddos-guard"

    def test_ignores_a_regular_page_behind_cloudflare(self) -> None:
        # Les pages déjà franchies chargent aussi ce script : il ne doit pas suffire à conclure au blocage.
        html = '<html><head><title>Solo Leveling</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js">'
        assert detect_challenge(html) is None


class TestTieredFetcher:
    async def test_uses_the_fast_tier_when_it_is_enough(self) -> None:
        fast, browser = FakeFetcher(), FakeFetcher(tier="browser")
        fast.add(URL_A, "<html>ok</html>")

        result = await TieredFetcher(fast, browser).fetch(URL_A)

        assert result.tier == "http"
        assert browser.calls == []

    async def test_escalates_to_the_browser_and_remembers_it_per_host(self) -> None:
        fast, browser = FakeFetcher(), FakeFetcher(tier="browser")
        fast.add(URL_A, blocked(URL_A))
        browser.add(URL_A, "<html>a</html>")
        browser.add(URL_B, "<html>b</html>")
        fetcher = TieredFetcher(fast, browser)

        first = await fetcher.fetch(URL_A)
        second = await fetcher.fetch(URL_B)

        assert (first.tier, second.tier) == ("browser", "browser")
        assert [call.url for call in fast.calls] == [URL_A]  # plus de requête rapide vers ce site

    async def test_propagates_a_block_from_the_browser_tier(self) -> None:
        fast, browser = FakeFetcher(), FakeFetcher(tier="browser")
        fast.add(URL_A, blocked(URL_A))
        browser.add(URL_A, blocked(URL_A))

        with pytest.raises(BlockedByAntiBotError):
            await TieredFetcher(fast, browser).fetch(URL_A)


class TestThrottledFetcher:
    async def test_spaces_out_requests_to_the_same_host_only(self) -> None:
        inner = FakeFetcher()
        for url in (URL_A, URL_B, "https://other.test/"):
            inner.add(url, "<html></html>")
        now = [100.0]
        sleeps: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            sleeps.append(seconds)
            now[0] += seconds

        fetcher = ThrottledFetcher(inner, min_interval_s=2.0, clock=lambda: now[0], sleep=fake_sleep)
        await fetcher.fetch(URL_A)
        now[0] += 0.5
        await fetcher.fetch(URL_B)  # même site, 0,5 s plus tard → attend 1,5 s
        await fetcher.fetch("https://other.test/")  # autre site → pas d'attente

        assert sleeps == [pytest.approx(1.5)]
