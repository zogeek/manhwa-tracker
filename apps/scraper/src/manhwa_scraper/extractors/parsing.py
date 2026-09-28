"""Fonctions pures de normalisation, partagées par tous les extracteurs (et testées une fois pour toutes)."""

import re
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

from selectolax.lexbor import LexborNode

from ..contract import ManhwaStatus, ManhwaType

PARIS = ZoneInfo("Europe/Paris")

_CHAPTER_NUMBER_RE = re.compile(r"(?:chap(?:itre|ter)?|ch|[ée]pisode|ep)\.?\s*(\d+(?:[.,]\d{1,2})?)", re.IGNORECASE)
_BARE_NUMBER_RE = re.compile(r"(\d+(?:[.,]\d{1,2})?)")

# Libellés FR/EN rencontrés sur les CMS de scantrad → valeurs de l'enum `manhwa_status` de l'API.
_STATUSES: tuple[tuple[tuple[str, ...], ManhwaStatus], ...] = (
    (("en cours", "ongoing", "publishing", "releasing"), ManhwaStatus.ongoing),
    (("termin", "complet", "completed", "fini", "finished"), ManhwaStatus.completed),
    (("pause", "hiatus", "suspendu"), ManhwaStatus.hiatus),
    (("abandon", "annul", "dropped", "cancel", "arrêt"), ManhwaStatus.cancelled),
)
_TYPES: tuple[tuple[tuple[str, ...], ManhwaType], ...] = (
    (("webtoon",), ManhwaType.webtoon),
    (("manhwa",), ManhwaType.manhwa),
    (("manhua",), ManhwaType.manhua),
    (("manga",), ManhwaType.manga),
)

_FR_MONTHS = {
    "janvier": 1, "février": 2, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6,
    "juillet": 7, "août": 8, "aout": 8, "septembre": 9, "octobre": 10, "novembre": 11, "décembre": 12, "decembre": 12,
}  # fmt: skip
_EN_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}  # fmt: skip
_MONTHS = _FR_MONTHS | _EN_MONTHS
_TEXT_DATE_RE = re.compile(r"(\d{1,2})\s+([a-zéû]+)\.?,?\s+(\d{4})", re.IGNORECASE)
_EN_TEXT_DATE_RE = re.compile(r"([a-zéû]+)\s+(\d{1,2}),?\s+(\d{4})", re.IGNORECASE)
_NUMERIC_DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")
_RELATIVE_RE = re.compile(r"(\d+)\s*(sec|min|heure|hour|h\b|jour|day|semaine|week|mois|month|an|year)", re.IGNORECASE)
_RELATIVE_UNITS: tuple[tuple[str, timedelta], ...] = (
    ("sec", timedelta(seconds=1)),
    ("min", timedelta(minutes=1)),
    ("heure", timedelta(hours=1)),
    ("hour", timedelta(hours=1)),
    ("h", timedelta(hours=1)),
    ("jour", timedelta(days=1)),
    ("day", timedelta(days=1)),
    ("semaine", timedelta(weeks=1)),
    ("week", timedelta(weeks=1)),
    ("mois", timedelta(days=30)),
    ("month", timedelta(days=30)),
    ("an", timedelta(days=365)),
    ("year", timedelta(days=365)),
)


def clean_text(node: LexborNode | None) -> str | None:
    """Texte d'un nœud, espaces normalisés ; `None` si absent ou vide."""
    if node is None:
        return None
    text = " ".join(node.text(separator=" ").split())
    return text or None


def image_url(node: LexborNode | None, base_url: str) -> str | None:
    """URL absolue d'une image, en tenant compte du lazy-loading (`data-src`, `data-lazy-src`, `srcset`)."""
    if node is None:
        return None
    for attr in ("data-src", "data-lazy-src", "src"):
        value = node.attributes.get(attr)
        if value and not value.startswith("data:"):
            return absolute_url(base_url, value.strip())
    srcset = node.attributes.get("srcset")
    if srcset:
        return absolute_url(base_url, srcset.split(",")[0].split()[0])
    return None


def absolute_url(base_url: str, href: str) -> str:
    return urljoin(base_url, href.strip())


def parse_chapter_number(label: str) -> Decimal | None:
    """« Chapitre 12.5 », « Ch. 7 », « Épisode 3 » → Decimal ; repli sur le premier nombre du libellé."""
    match = _CHAPTER_NUMBER_RE.search(label) or _BARE_NUMBER_RE.search(label)
    if match is None:
        return None
    return Decimal(match.group(1).replace(",", "."))


def parse_chapter_title(label: str) -> str | None:
    """« Chapitre 12 - Le retour » / « Chapitre 68 : L'invitation » → le titre seul, sinon `None`."""
    for separator in (" - ", " – ", " : "):
        if separator in label:
            return label.split(separator, 1)[1].strip() or None
    return None


def parse_status(label: str | None) -> ManhwaStatus | None:
    if not label:
        return None
    lowered = label.lower()
    for needles, status in _STATUSES:
        if any(needle in lowered for needle in needles):
            return status
    return None


def parse_type(label: str | None) -> ManhwaType | None:
    if not label:
        return None
    lowered = label.lower()
    for needles, kind in _TYPES:
        if any(needle in lowered for needle in needles):
            return kind
    return None


def parse_date(label: str | None, *, now: datetime | None = None) -> datetime | None:
    """Dates de sortie telles qu'affichées par les CMS : absolues (FR/EN, JJ/MM/AAAA) ou relatives (« il y a 3 h »).

    Les dates sans heure sont interprétées à minuit, heure de Paris, puis renvoyées avec leur fuseau.
    """
    if not label:
        return None
    text = label.strip().lower()
    reference = now or datetime.now(UTC)

    if match := _TEXT_DATE_RE.search(text):
        day, month_name, year = match.groups()
        if (month := _MONTHS.get(month_name)) is not None:
            return datetime(int(year), month, int(day), tzinfo=PARIS)
    if match := _EN_TEXT_DATE_RE.search(text):
        month_name, day, year = match.groups()
        if (month := _MONTHS.get(month_name)) is not None:
            return datetime(int(year), month, int(day), tzinfo=PARIS)
    if match := _NUMERIC_DATE_RE.search(text):
        day, month_num, year = match.groups()
        return datetime(int(year), int(month_num), int(day), tzinfo=PARIS)
    if match := _RELATIVE_RE.search(text):
        amount, unit = int(match.group(1)), match.group(2).lower()
        for prefix, delta in _RELATIVE_UNITS:
            if unit.startswith(prefix):
                return reference - amount * delta
    if any(word in text for word in ("aujourd", "today")):
        return reference
    if any(word in text for word in ("hier", "yesterday")):
        return reference - timedelta(days=1)
    return None
