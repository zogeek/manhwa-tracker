"""mangas-origines.fr — Madara avec un thème enfant (`child-origines`).

Relevé du 2026-09-27 : l'étage HTTP (curl_cffi) suffit, pas de challenge JavaScript.
Les fiches vivent sous `/oeuvre/<slug>/`. Le titre suit le sélecteur Madara standard, mais la liste
des chapitres est remplacée par un composant maison (`.ori-chl`, chargé par `ajax/chapters/`) :
surcharger `selectors.chapter_item` / `chapter_link` avant de passer `ready` à `True`.
"""

from typing import ClassVar

from ..themes import MadaraExtractor


class MangasOriginesExtractor(MadaraExtractor):
    slug: ClassVar[str] = "mangas-origines"
    name: ClassVar[str] = "Mangas Origines"
    base_url: ClassVar[str] = "https://mangas-origines.fr/"
    series_path: ClassVar[str] = "oeuvre"
    # TODO(selectors) : selectors = replace(MadaraSelectors(), chapter_item="…", chapter_link="…")
