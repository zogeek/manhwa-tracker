"""mangas-origines.fr — Madara avec un thème enfant (`child-origines`).

Relevé du 2026-09-27 : l'étage HTTP (curl_cffi) suffit, pas de challenge JavaScript.
- Catalogue : Madara standard (`/oeuvre/page/N/`, 16 fiches par page, 404 après la dernière).
  `robots.txt` interdit `/*?m_orderby=` (relevé du 2026-10-06) : le contrôle dynamique du fetcher fait retomber le
  catalogue sur `/oeuvre/` sans paramètre, dont le tri par défaut est déjà « dernières sorties ».
- Fiche : mise en page maison `ori-sr-*` ; statut et type dans une liste `<dl>` (`<dt>` libellé / `<dd>` valeur).
- Chapitres : composant maison `ori-chl-*`, déjà complet dans la fiche (pas d'appel AJAX).
  Numéro dans `data-num` (gère 179.5), date complète dans `title` (le texte affiche « 21/06/23 »).
"""

from typing import ClassVar

from selectolax.lexbor import LexborHTMLParser

from ..parsing import clean_text
from ..themes import MadaraExtractor, MadaraSelectors


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
