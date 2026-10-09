"""mangas-origines.fr — Madara avec un thème enfant (`child-origines`).

Relevé du 2026-09-27 : l'étage HTTP (curl_cffi) suffit, pas de challenge JavaScript.
- Catalogue : Madara standard (`/oeuvre/page/N/`, 16 fiches par page, 404 après la dernière).
  `robots.txt` interdit `/*?m_orderby=` (relevé du 2026-10-06) : le contrôle dynamique du fetcher fait retomber le
  catalogue sur `/oeuvre/` sans paramètre, dont le tri par défaut est déjà « dernières sorties ».
- Fiche : mise en page maison `ori-sr-*` ; statut et type dans une liste `<dl>` (`<dt>` libellé / `<dd>` valeur).
- Chapitres : composant maison `ori-chl-*`, déjà complet dans la fiche (pas d'appel AJAX).
  Numéro dans `data-num` (gère 179.5), date complète dans `title` (le texte affiche « 21/06/23 »).
- Recherche native (relevé du 2026-10-09) : POST `/wp-admin/admin-ajax.php`, `action=madara_child_search&term=…`,
  réponse JSON `{"success": true, "data": [{"title", "url", "thumb", …}]}` (`data` vide si aucun résultat).
  `robots.txt` interdit `/wp-admin/` mais autorise explicitement `/wp-admin/admin-ajax.php`.
"""

import html
from typing import ClassVar

from pydantic import BaseModel, JsonValue, TypeAdapter, ValidationError
from selectolax.lexbor import LexborHTMLParser

from ..base import ExtractionError, SeriesLink
from ..parsing import clean_text
from ..themes import MadaraExtractor, MadaraSelectors

AJAX_PATH = "wp-admin/admin-ajax.php"
SEARCH_ACTION = "madara_child_search"


class _SearchHit(BaseModel):
    """Seuls les champs lus sont déclarés : `thumb`, `genres`, `rating` sont ignorés."""

    title: str
    url: str


class _SearchResponse(BaseModel):
    success: bool
    data: JsonValue = None
    """Liste de résultats si `success`, sinon un message d'erreur WordPress (forme libre)."""


_SEARCH_HITS = TypeAdapter(list[_SearchHit])


def parse_search_response(body: str) -> list[SeriesLink]:
    """JSON de `madara_child_search` → œuvres, dans l'ordre du site. `ExtractionError` si la forme change."""
    try:
        response = _SearchResponse.model_validate_json(body)
        hits = _SEARCH_HITS.validate_python(response.data) if response.success else []
    except ValidationError as error:
        raise ExtractionError(f"Réponse de recherche inattendue : {error}") from error
    # WordPress encode les entités du titre (`L&#8217;ascension`).
    return [SeriesLink(title=html.unescape(hit.title), url=hit.url) for hit in hits]


class MangasOriginesExtractor(MadaraExtractor):
    slug: ClassVar[str] = "mangas-origines"
    name: ClassVar[str] = "Mangas Origines"
    base_url: ClassVar[str] = "https://mangas-origines.fr/"
    series_path: ClassVar[str] = "oeuvre"
    ready: ClassVar[bool] = True
    selectors: ClassVar[MadaraSelectors] = MadaraSelectors(
        title=".ori-sr-title",
        cover=".ori-sr-cover img",
        synopsis=".ori-sr-syn-texte",
        chapter_item=".ori-chl-row",
        chapter_link="a.ori-chl-corps",
        chapter_label=".ori-chl-nom-long",
        chapter_number_attr="data-num",
        chapter_date=".ori-chl-date",
        chapter_date_attr="title",
    )

    async def search_series(self, title: str) -> list[SeriesLink]:
        result = await self._fetcher.fetch(
            f"{self.base_url}{AJAX_PATH}",
            method="POST",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": self.base_url,
            },
            data={"action": SEARCH_ACTION, "term": title},
        )
        return parse_search_response(result.html)

    def parse_info_table(self, document: LexborHTMLParser) -> dict[str, str]:
        info: dict[str, str] = {}
        label: str | None = None
        for node in document.css(".ori-sr-infos dl > dt, .ori-sr-infos dl > dd"):
            if node.tag == "dt":
                label = clean_text(node)
            elif label is not None and (value := clean_text(node)):
                info[label.lower()] = value
                label = None
        return info
