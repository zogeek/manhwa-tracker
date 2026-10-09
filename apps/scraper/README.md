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

### Trois façons de choisir les fiches à scraper

Le scraper ne cherche pas à inventorier les catalogues : la découverte et les métadonnées de référence viennent
d'AniList. Il sert au « dernier kilomètre » francophone : savoir **où** lire une œuvre et quand sort un chapitre.

| Flux | Commande | Requêtes | Usage |
|---|---|---|---|
| Dernières sorties | `run <slug> --source-id …` | 1 page de listing + 1 par fiche | suivi des nouveautés, lancé souvent |
| Top du site | `run <slug> --source-id … --discovery top` | 1 page (le Top) + 1 par fiche | suggestions : ce que lit la communauté |
| URL directe | `track --source-id … <url> [<url>…]` ou `--urls-file suivies.txt` | 1 par fiche, aucun catalogue | séries suivies par les utilisateurs |
| Suivi depuis l'API | `track --source-id … --from-api <slug>` | 1 par fiche (+ 1 recherche par URL manquante, chez le moteur) | toutes les séries suivies, sans liste à tenir |

En mode `track`, la source est déduite du domaine de chaque URL (toutes doivent appartenir à la même source, car un
run est rattaché à une ligne de `sources`). Le fichier contient une URL par ligne ; lignes vides et `#` ignorées.
Seules les sources qui exposent un Top côté serveur acceptent `--discovery top` (aujourd'hui : scan-manga).

En mode `track`, un lien de chapitre est ramené à sa fiche (`SourceExtractor.series_url`).

**`track --from-api <slug>`** lit `GET /api/ingest/tracked` (clé de service, curseur suivi jusqu'à la dernière page) :
une série est suivie dès qu'elle est dans une liste de lecture active ou qu'un utilisateur a une progression dessus.
Les séries dont l'URL est connue sur la source sont scrapées d'abord ; pour les autres, l'URL est cherchée par
dorking (`search`, ci-dessous) puis la page est rattachée à l'œuvre de l'API (`manhwaId`) : le lien source ↔ œuvre
est créé, sans fiche en double. Sans moteur configuré, ou s'il tombe en panne, seules les URLs connues sont scrapées ;
une page trouvée qui appartient déjà à une autre œuvre suivie est écartée. Une liste de suivi vide n'est pas un échec.

**Recherche sur le site : non disponible.** Aucune source prête ne l'autorise : scan-manga la sert uniquement aux
navigateurs (refus ciblé, voir « Ligne rouge ») et le `robots.txt` de mangas-origines interdit `/?s=`.

**Recherche par dorking : `search`.** Pour trouver l'URL d'une fiche à partir de son titre, on interroge un moteur
tiers avec `site:scan-manga.com "Le Royaume"` : le site cible ne reçoit aucune requête. On garde le premier résultat
que l'extracteur reconnaît comme une fiche. Une recherche par œuvre suffit : l'URL est ensuite stockée côté API et
partagée par tous les utilisateurs.

Moteur : une instance **SearXNG auto-hébergée** (`SEARXNG_URL`), sans compte chez un tiers. L'API Brave Search
reste codée en repli, inactive tant que `SEARXNG_URL` est défini (et sans `BRAVE_SEARCH_API_KEY`). Instance locale :

```yaml
# docker-compose.yml — puis, dans ./searxng/settings.yml : `use_default_settings: true`,
# `server.secret_key: <openssl rand -hex 32>` et `search.formats: [html, json]` (sinon l'API JSON répond 403).
services:
  searxng:
    image: searxng/searxng:latest
    ports: ["127.0.0.1:8080:8080"]
    volumes: ["./searxng:/etc/searxng"]
    restart: unless-stopped
```

```sh
uv run manhwa-scraper search scan-manga "Le Royaume"
uv run manhwa-scraper track --source-id <uuid> "$(uv run manhwa-scraper search scan-manga 'Le Royaume')"
```

| Script | Rôle |
|---|---|
| `dev` | `manhwa-scraper` : liste les sources (`sources`) ; `run <slug>` lance un scraping ; `track <url>…` scrape des fiches précises (`track --from-api <slug>` : les séries suivies) ; `search <slug> "<titre>"` trouve une fiche |
| `lint` / `format` | Ruff (lint + formatage) |
| `typecheck` | mypy `--strict` (plugin Pydantic) |
| `test` | pytest — aucun réseau, aucun navigateur (fakes + fixtures HTML synthétiques ; SearXNG et Brave simulés par `httpx.MockTransport`) |
| `contract:generate` | Régénère `contract.py` depuis le JSON Schema de l'API (datamodel-codegen) |

## Contrat avec l'API : source unique de vérité

Les modèles des requêtes (`src/manhwa_scraper/contract.py`) ne s'écrivent **pas** à la main :

```
apps/api/src/modules/ingestion/ingestion.validator.ts   (Zod — la seule source)
        │  pnpm --filter api contract:generate           (z.toJSONSchema)
        ▼
apps/api/contracts/ingestion.schema.json                (JSON Schema, commité)
        │  pnpm --filter scraper contract:generate       (datamodel-codegen, config dans pyproject.toml)
        ▼
apps/scraper/src/manhwa_scraper/contract.py             (Pydantic, commité, ne pas éditer)
```

Après toute modification du validateur d'ingestion : **`pnpm contract:generate` à la racine**, puis commiter
les deux fichiers générés. Si on l'oublie, deux tests échouent (Vitest côté API, pytest côté scraper) — et la CI avec.

La politique de validation propre au worker (champs inconnus refusés, modèles immuables) vit dans
`contract_base.py`, classe de base des modèles générés. Les réponses de l'API, qui ne sont pas décrites
en Zod, restent dans `models.py` (tolérantes aux champs inconnus).

## Éthique et conformité

Ce worker alimente un **tracker personnel** : il suit les sorties de chapitres, il ne constitue pas une copie des sites.

**Ce qu'il collecte et ce qu'il en fait**
- Uniquement des métadonnées : titre, synopsis, URL de couverture, numéros et **liens** de chapitres. Aucune image
  de chapitre, aucun contenu de lecture. Chaque chapitre renvoie vers le site source, qui garde son audience.
- Aucune redistribution publique, aucune revente, **aucun entraînement de modèle d'IA** (le signal
  `Content-signal: ai-train=no` de scan-manga.com est respecté par construction).

**`robots.txt`**
- **Vérifié automatiquement avant chaque requête** (catalogue, Top, fiche, appel AJAX de chapitres) par
  `RobotsGuardedFetcher` : une URL interdite n'est jamais demandée (`DisallowedByRobotsError`). Une fiche interdite
  est écartée sans dégrader le run ; une page de catalogue triée interdite (`/*?m_orderby=` sur mangas-origines)
  retombe sur sa variante sans paramètre (`catalog_page_urls`).
- Lu une fois par origine (`www.` et un sous-domaine ont chacun le leur), gardé en cache
  `SCRAPER_ROBOTS_TTL_S` (24 h par défaut, le maximum de la RFC 9309). Interprété par Protego (parseur de Scrapy) :
  jokers `*`/`$`, règle la plus longue gagnante, groupes `User-Agent: *` multiples fusionnés (scan-manga en a deux).
- Reste à relire **à la main** à l'ajout d'une source : un extracteur dont toutes les pages seraient interdites ne
  servirait à rien, et un refus ciblé ne passe pas toujours par `robots.txt` (voir « Ligne rouge »).
- scan-manga.com interdit nommément les robots d'IA (GPTBot, ClaudeBot…). Ce worker n'en est pas un : il ne
  moissonne pas le web pour un modèle, il consulte quelques pages pour son propriétaire. Il relève de la règle
  générale (jeton `manhwa-scraper`, sans groupe à son nom → `User-Agent: *`).
- Un `robots.txt` indisponible (4xx) vaut « pas de restriction » (RFC 9309, §2.3.1.3) ; injoignable (5xx, 429,
  réseau) vaut « tout est interdit », relu 10 min plus tard. Un challenge anti-bot sur le fichier arrête le run.

**Politesse**
- Au plus une requête toutes les 1,5 s par site (`SCRAPER_REQUEST_INTERVAL_S`), une seule requête par fiche quand
  c'est possible, découverte limitée aux dernières sorties, au Top ou aux URLs suivies plutôt qu'au catalogue entier.
- Un blocage anti-bot arrête le run immédiatement (source marquée `blocked`) : on n'insiste pas.

**Ligne rouge : on ne contourne jamais un refus ciblé**

L'étage curl_cffi / Camoufox sert à passer les filtres **génériques** (un pare-feu qui rejette tout client non
navigateur sur des pages que le site sert à tout le monde et que son `robots.txt` autorise). En revanche, quand le
site refuse **délibérément une ressource précise** aux clients automatisés, on s'arrête. Exemples relevés sur
scan-manga.com :
- le sitemap, refusé (403) hors moteurs de recherche ;
- `scan.data.json` (catalogue complet de ~16 000 œuvres), servi aux navigateurs mais **vide** pour un client HTTP
  aux en-têtes identiques, derrière un code JavaScript obfusqué ;
- la recherche : `liste_series.html?q=…` est remplie depuis ce même `scan.data.json`, et les suggestions
  `qsearch.json` (pourtant publiées dans `osd.xml`) répondent elles aussi 200 au corps **vide** à un client HTTP ;
- plus généralement : pas de désobfuscation de code, pas de jeton rejoué, pas de compte ni de paywall contourné.

Même règle pour les services tiers. Recherche par « dorking » (`site:scan-manga.com "Titre"`) sur DuckDuckGo,
évaluée puis **écartée** (relevé du 2026-10-06) : le `robots.txt` de `html.duckduckgo.com` et
`lite.duckduckgo.com` autorise tout, mais une requête automatisée honnête (User-Agent du worker, sans
déguisement) reçoit un HTTP 202 contenant un CAPTCHA (« Unfortunately, bots use DuckDuckGo too »). C'est un refus
ciblé des clients automatisés : le franchir avec curl_cffi / Camoufox serait exactement ce qu'on s'interdit. Pistes
conformes retenues : une instance SearXNG auto-hébergée pour `search` (une requête par œuvre, jamais en boucle ;
l'instance suspend d'elle-même un moteur qui lui oppose un CAPTCHA, sans le contourner), et l'URL collée à la main
pour `track`. L'API Brave Search reste disponible en repli mais exige un compte nominatif chez un tiers.

Exemple de correction : mangas-origines.fr interdit `/*?m_orderby=` ; la découverte demande donc `/oeuvre/`
sans paramètre (tri par défaut = dernières sorties) au lieu de `?m_orderby=latest`.

Si une source ne peut pas être suivie dans ces limites, on la suit partiellement (dernières sorties, Top, URLs suivies) ou pas du tout,
et on peut toujours demander l'autorisation à ses administrateurs.

## Stack

| Besoin | Choix | Pourquoi |
|---|---|---|
| Paquets / Python | **uv** | Résolution et installation 10–100× plus rapides que pip/Poetry, lockfile multiplateforme, installe lui-même la bonne version de Python (`.python-version`). |
| Anti-bot, étage rapide | **curl_cffi** | Rejoue l'empreinte TLS/HTTP2 de Chrome : passe les WAF qui filtrent les clients Python sur la poignée de main (scan-manga.com : 403 pour `curl` même déguisé en Chrome, car son empreinte contredit son User-Agent ; 200 avec curl_cffi). |
| Anti-bot, étage navigateur | **Camoufox** | Firefox dont l'empreinte est falsifiée dans le moteur (C++), pas en JavaScript. Sur astral-manga.fr, Chromium (même patché) reste bloqué par le challenge Cloudflare ; Camoufox le passe. |
| Pilotage du navigateur | **Playwright** (API seule) | Camoufox se pilote avec l'API Playwright : on garde la « télécommande » (`page.goto`, `page.content`…), seul le navigateur change. Déclaré explicitement car `browser.py` l'importe directement. |
| Parsing HTML | **selectolax** (Lexbor) | Sélecteurs CSS, parseur en C bien plus rapide que BeautifulSoup. |
| Validation | **Pydantic v2** (+ pydantic-settings) | Modèles **générés** depuis le contrat Zod de l'API (datamodel-codegen) : un champ faux échoue côté worker, avec un message lisible, avant l'envoi. |
| Client API | **httpx** + **tenacity** | Async, timeouts, transport mockable en test ; ré-essais exponentiels uniquement quand rejouer est sans danger (lots idempotents). |

## Architecture

```
src/manhwa_scraper/
├── cli.py                 composition root : seul endroit qui instancie les implémentations
├── config.py              Settings (variables SCRAPER_*)
├── contract.py            modèles des requêtes /api/ingest — GÉNÉRÉ depuis le Zod de l'API
├── contract_base.py       politique de validation du worker (base des modèles générés)
├── models.py              réponses de l'API + sérialisation camelCase
├── ingest_client.py       client HTTP de l'API (clé de service, ré-essais, idempotence)
├── pipeline.py            ScrapeRunner : cibles (catalogue, Top ou URLs) → fiches → lots, scrape_runs + source_health
├── search.py              dorking : SearchEngine (protocole), SearxngSearchEngine, BraveSearchEngine (repli), SeriesFinder
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
2. Créer `extractors/sites/<site>.py` : `slug`, `name`, `base_url`, et au besoin `series_path` / `selectors`. Un thème enfant Madara se décrit souvent par la seule configuration (`chapter_number_attr`, `chapter_date_attr`…) ; `parse_info_table` se surcharge si le bloc « Statut / Type » est différent (exemple : `mangas_origines.py`).
3. L'ajouter à `ALL_SOURCES` (`extractors/sites/__init__.py`).
4. Écrire un test sur une fixture HTML **synthétique** (reproduire la structure, pas le contenu du site), puis passer `ready = True`.

### État des sources (relevé du 2026-09-27)

| Source | Moteur | Protection | Étage suffisant | État |
|---|---|---|---|---|
| mangas-origines.fr | Madara (thème enfant) | Cloudflare | HTTP | ✅ **prêt** (1 requête par fiche, chapitres compris ; essai réel : 3 œuvres, 417 chapitres ingérés) |
| scan-manga.com | PHP propriétaire | Cloudflare (bot management) | HTTP (curl_cffi) | ✅ **prêt** : découverte par l'accueil (~100 dernières sorties, ou Top découvertes BD ~85 œuvres ; le catalogue complet et la recherche sont réservés aux navigateurs), romans écartés, tomes licenciés ignorés |
| rimuscan.fr | Next.js | Cloudflare (sans challenge) | HTTP | squelette |
| astral-manga.fr | Next.js | Cloudflare (challenge JS) | Navigateur (Camoufox) | squelette |
