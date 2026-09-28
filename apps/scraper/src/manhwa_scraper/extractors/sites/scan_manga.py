"""scan-manga.com — site PHP propriétaire (ni Madara ni MangaThemesia), agrégateur de nombreuses teams.

Relevé du 2026-09-27 :
- Protection (Cloudflare) : `python-httpx` en User-Agent → 403 ; `curl` déguisé en Chrome
  → 403 (son empreinte TLS/HTTP2 contredit le User-Agent) ; curl_cffi (Chrome cohérent sur toutes les couches)
  → 200, sans navigateur. httpx déguisé passe aussi ce jour-là, mais sur la seule foi du User-Agent : une règle
  JA3/JA4 côté Cloudflare suffirait à le bloquer, pas curl_cffi.
- Identité : le site redirige vers `www.`, et la forme courte `/1805/X.html` fait un 301 vers `/1805-54398/X.html` :
  l'URL finale sert d'identité de l'œuvre, sans doublon possible.
- Catalogue : les pages « liste » sont remplies en JavaScript (le HTML n'y contient que le « Top » du pied de
  page) et le sitemap est refusé (403 du serveur, réservé aux moteurs). La découverte part donc de l'accueil,
  qui liste côté serveur les ~100 dernières sorties : la source idéale d'un suivi de nouveautés lancé souvent,
  mais pas un inventaire du catalogue historique.
- Catalogue complet, volontairement NON utilisé (relevé du 2026-09-28) : `liste_series.html` charge en XHR
  `https://bqj.scan-manga.com/scanlation/scan.data.json` (~2,4 Mo, ~16 000 œuvres, JSON en clair). Un vrai
  navigateur le reçoit ; un client HTTP avec les mêmes en-têtes (Origin, Referer, Accept) et le même parcours
  reçoit un 200 au corps VIDE. Seule différence : l'exécution du JavaScript de détection de bots de Cloudflare.
  Le site réserve donc sciemment cette ressource aux navigateurs (code de la page obfusqué, robots.txt hostile
  aux robots d'IA) : c'est un refus ciblé de l'extraction en masse, on ne le contourne pas (cf. README, « Éthique »).
- Fiche : type dans le fil d'Ariane (Manga / Manhwa / Novel…), fiche technique en deux listes parallèles
  (libellés / valeurs), synopsis et couverture en microdonnées schema.org.
- Chapitres : `li.chapitre` groupés par volume ; les chapitres de tomes parus en France n'ont pas de lien
  (non lisibles) et sont ignorés. Pas de date de sortie sur la fiche.
"""

from typing import ClassVar

from selectolax.lexbor import LexborHTMLParser

from ...contract import IngestChapter, IngestManhwa
from ..base import ExtractionError, SourceExtractor, UnsupportedSeriesError
from ..parsing import absolute_url, clean_text, parse_chapter_number, parse_chapter_title, parse_status, parse_type

# Catégories du fil d'Ariane hors du périmètre du tracker (le contrat ne connaît que manga/manhwa/manhua/webtoon).
UNSUPPORTED_CATEGORIES = frozenset({"novel"})


class ScanMangaExtractor(SourceExtractor):
    slug: ClassVar[str] = "scan-manga"
    name: ClassVar[str] = "Scan-Manga"
    base_url: ClassVar[str] = "https://www.scan-manga.com/"
    ready: ClassVar[bool] = True
    max_catalog_pages: ClassVar[int] = 1  # seul l'accueil est rendu côté serveur (voir la docstring du module)

    def catalog_page_url(self, page: int) -> str:
        return self.base_url

    def parse_catalog_page(self, document: LexborHTMLParser, page_url: str) -> list[str]:
        urls: dict[str, None] = {}
        for link in document.css("#content_news .listing a.nom_manga"):
            href = link.attributes.get("href")
            if href:
                urls[absolute_url(page_url, href)] = None
        return list(urls)

    def parse_series(self, document: LexborHTMLParser, series_url: str) -> IngestManhwa:
        title = clean_text(document.css_first('h2[itemprop~="headline"]'))
        if title is None:
            raise ExtractionError(f"Titre introuvable sur {series_url}")
        category = clean_text(document.css_first("#navigation h1"))
        if category is not None and category.lower() in UNSUPPORTED_CATEGORIES:
            raise UnsupportedSeriesError(f"catégorie « {category} » hors périmètre")
        cover = document.css_first('meta[property="og:image"]')
        return IngestManhwa(
            source_manhwa_url=series_url,
            title=title,
            synopsis=clean_text(document.css_first('[itemprop="description"]')),
            cover_url=cover.attributes.get("content") if cover is not None else None,
            type=parse_type(category),
            status=parse_status(self.parse_info_table(document).get("statut")),
        )

    def parse_chapters(self, document: LexborHTMLParser, series_url: str) -> list[IngestChapter]:
        chapters: list[IngestChapter] = []
        for item in document.css("li.chapitre"):
            link = item.css_first(".chapitre_nom a")
            href = link.attributes.get("href") if link is not None else None
            label = clean_text(item.css_first(".chapitre_nom"))
            number = parse_chapter_number(label) if label else None
            if not href or label is None or number is None:
                continue  # tome paru en France (pas de lien) ou « Chapitre Extra » sans numéro
            chapters.append(
                IngestChapter(
                    number=number,
                    url=absolute_url(series_url, href),
                    language=self.language,
                    title=parse_chapter_title(label),
                )
            )
        return chapters

    def parse_info_table(self, document: LexborHTMLParser) -> dict[str, str]:
        """Fiche technique : libellés et valeurs sont deux `<ul>` parallèles, appariés dans l'ordre."""
        labels = [clean_text(li) for li in document.css(".contenu_titres_fiche_technique li")]
        values = [clean_text(li) for li in document.css(".contenu_texte_fiche_technique > ul > li")]
        return {
            label.lower(): value
            for label, value in zip(labels, values, strict=False)
            if label is not None and value is not None
        }
