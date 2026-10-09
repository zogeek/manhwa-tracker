"""Cibles d'un run « séries suivies » : les œuvres que l'API déclare suivies, vues depuis une source.

Une œuvre suivie dont l'URL est connue sur la source est scrapée telle quelle. Sinon (série suivie mais jamais
vue sur cette source), on cherche sa fiche par dorking (`SeriesFinder`) ; la page trouvée est rattachée à l'œuvre
de l'API (`manhwa_id`), ce qui crée le lien source ↔ œuvre au lieu d'une fiche en double.
"""

import logging
from collections.abc import AsyncIterable, AsyncIterator

from .contract import TrackedSeries
from .extractors import SourceExtractor
from .pipeline import ScrapeTarget
from .search import SearchError, SeriesFinder

logger = logging.getLogger(__name__)


async def tracked_targets(
    series: AsyncIterable[TrackedSeries],
    extractor: type[SourceExtractor],
    finder: SeriesFinder | None,
) -> AsyncIterator[ScrapeTarget]:
    """Une cible par œuvre suivie dont la fiche est connue ou retrouvée ; les autres sont journalisées et sautées.

    Les URLs connues passent d'abord, les recherches ensuite : une page trouvée qui appartient déjà à une autre
    œuvre suivie est ainsi reconnue et écartée (l'API refuserait le lot entier : URL rattachée à une autre œuvre).
    `finder` absent (aucun moteur configuré) ou en panne : seules les URLs déjà connues sont scrapées.
    """
    owners: dict[str, str] = {}  # URL → titre de l'œuvre qui la porte
    unlinked: list[TrackedSeries] = []
    async for tracked in series:
        if tracked.manhwa_url is None:
            unlinked.append(tracked)
            continue
        url = str(tracked.manhwa_url)  # telle quelle : c'est la clé du lien côté API
        owners[extractor.series_url(url) or url] = tracked.title  # forme canonique, comparable aux URLs trouvées
        yield ScrapeTarget(url=url, manhwa_id=tracked.manhwa_id)

    for tracked in unlinked:
        if finder is None:
            logger.warning("« %s » : aucune URL sur %s ni moteur de recherche, ignorée", tracked.title, extractor.slug)
            continue
        try:
            found = await finder.find(extractor, tracked.title)
        except SearchError as error:
            # Un moteur qui ne répond plus ne répondra pas mieux à la série suivante : on arrête de chercher.
            logger.warning("Recherche désactivée pour ce run : %s", error)
            finder = None
            continue
        except ValueError as error:  # titre vide une fois nettoyé
            logger.warning("« %s » : recherche impossible (%s), ignorée", tracked.title, error)
            continue
        if found is None:
            logger.warning("« %s » : aucune fiche trouvée sur %s, ignorée", tracked.title, extractor.slug)
            continue
        if (owner := owners.get(found)) is not None:
            logger.warning("« %s » : %s est déjà la fiche de « %s », ignorée", tracked.title, found, owner)
            continue
        logger.info("« %s » : fiche trouvée %s", tracked.title, found)
        owners[found] = tracked.title
        yield ScrapeTarget(url=found, manhwa_id=tracked.manhwa_id)
