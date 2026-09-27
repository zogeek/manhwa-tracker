# Scraper — worker Python

Extrait les œuvres et chapitres des sites de scantrad et les pousse vers l'API Hono (`/api/ingest/*`,
clé de service `x-api-key`). Il ne touche jamais la base : l'API reste l'unique point d'entrée.

## Démarrage

```sh
# uv : https://docs.astral.sh/uv/ (curl -LsSf https://astral.sh/uv/install.sh | sh)
pnpm --filter scraper setup     # uv sync + téléchargement du navigateur Camoufox (une fois)
cp .env.example .env            # SCRAPER_API_KEY = même valeur que côté API
pnpm --filter scraper dev       # liste les sources et leur état
uv run manhwa-scraper run <slug> --source-id <uuid-de-la-source> [--max-series 5]
```

| Script | Rôle |
|---|---|
| `dev` | `manhwa-scraper` : liste les sources (`sources`) ; `run <slug>` lance un scraping |
| `lint` / `format` | Ruff (lint + formatage) |
| `typecheck` | mypy `--strict` (plugin Pydantic) |
| `test` | pytest — aucun réseau, aucun navigateur (fakes + fixtures HTML synthétiques) |

## Stack

| Besoin | Choix | Pourquoi |
|---|---|---|
| Paquets / Python | **uv** | Résolution et installation 10–100× plus rapides que pip/Poetry, lockfile multiplateforme, installe lui-même la bonne version de Python (`.python-version`). |
| Anti-bot, étage rapide | **curl_cffi** | Rejoue l'empreinte TLS/HTTP2 de Chrome : passe les WAF qui filtrent les clients Python sur la poignée de main (scan-manga.com : 403 avec un client classique, 200 avec curl_cffi). |
| Anti-bot, étage navigateur | **Camoufox** | Firefox dont l'empreinte est falsifiée dans le moteur (C++), pas en JavaScript. Sur astral-manga.fr, Chromium (même patché) reste bloqué par le challenge Cloudflare ; Camoufox le passe. |
| Pilotage du navigateur | **Playwright** (API seule) | Camoufox se pilote avec l'API Playwright : on garde la « télécommande » (`page.goto`, `page.content`…), seul le navigateur change. Déclaré explicitement car `browser.py` l'importe directement. |
| Parsing HTML | **selectolax** (Lexbor) | Sélecteurs CSS, parseur en C bien plus rapide que BeautifulSoup. |
| Validation | **Pydantic v2** (+ pydantic-settings) | Miroir du contrat Zod de l'API : un champ faux échoue côté worker, avec un message lisible, avant l'envoi. |
| Client API | **httpx** + **tenacity** | Async, timeouts, transport mockable en test ; ré-essais exponentiels uniquement quand rejouer est sans danger (lots idempotents). |

## Architecture

```
src/manhwa_scraper/
├── cli.py                 composition root : seul endroit qui instancie les implémentations
├── config.py              Settings (variables SCRAPER_*)
├── models.py              contrat /api/ingest (Pydantic, sérialisé en camelCase)
├── ingest_client.py       client HTTP de l'API (clé de service, ré-essais, idempotence)
├── pipeline.py            ScrapeRunner : catalogue → fiches → lots, scrape_runs + source_health
├── fetching/
│   ├── base.py            PageFetcher (protocole), FetchResult, détection des challenges
│   ├── http.py            CurlCffiFetcher   (étage rapide)
│   ├── browser.py         CamoufoxFetcher   (étage navigateur, lancé seulement si besoin)
│   └── tiered.py          TieredFetcher (escalade mémorisée par site) + ThrottledFetcher (politesse)
└── extractors/
    ├── base.py            SourceExtractor : déroulé commun (template method)
    ├── registry.py        ExtractorRegistry : slug / URL → extracteur (factory)
    ├── parsing.py         numéros de chapitre, statuts, dates FR/EN
    ├── themes/            un extracteur complet par CMS : Madara, MangaThemesia
    └── sites/             un fichier par site (hérite d'un thème ou de SourceExtractor)
```

### Ajouter un site

1. Identifier le CMS (`wp-content/themes/madara` → `MadaraExtractor`, `mangareader`/`themesia` → `MangaThemesiaExtractor`, sinon `SourceExtractor`).
2. Créer `extractors/sites/<site>.py` : `slug`, `name`, `base_url`, et au besoin `series_path` / `selectors`.
3. L'ajouter à `ALL_SOURCES` (`extractors/sites/__init__.py`).
4. Écrire un test sur une fixture HTML **synthétique** (reproduire la structure, pas le contenu du site), puis passer `ready = True`.

### État des sources (relevé du 2026-09-27)

| Source | Moteur | Protection | Étage suffisant | État |
|---|---|---|---|---|
| mangas-origines.fr | Madara (thème enfant) | Cloudflare | HTTP | squelette : liste de chapitres maison à cibler |
| scan-manga.com | PHP propriétaire | Cloudflare (filtre TLS) | HTTP (curl_cffi) | squelette |
| rimuscan.fr | Next.js | Cloudflare (sans challenge) | HTTP | squelette |
| astral-manga.fr | Next.js | Cloudflare (challenge JS) | Navigateur (Camoufox) | squelette |
