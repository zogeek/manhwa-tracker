"""Réponses de l'API et sérialisation des requêtes.

Les corps de REQUÊTE ne sont plus écrits à la main : ils sont générés depuis les validateurs Zod
de l'API (`contract.py`, cf. `pnpm contract:generate`). Restent ici les RÉPONSES, que l'API ne
décrit pas en Zod (lignes Drizzle) : on n'y lit que quelques champs et on ignore le reste.
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from .contract_base import ContractModel


class ResponseModel(BaseModel):
    """Tolère les champs inconnus : une évolution des réponses de l'API ne doit pas casser le worker."""

    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True, validate_by_alias=True, extra="ignore")


class ScrapeRun(ResponseModel):
    id: UUID
    status: str


class BatchResult(ResponseModel):
    chapters_created: int
    releases_created: int
    releases_updated: int
    covers_added: int


class HealthResult(ResponseModel):
    recorded: int


def to_payload(model: ContractModel) -> dict[str, object]:
    """Corps JSON attendu par l'API : camelCase, sans les champs absents, dates ISO 8601 avec fuseau."""
    return model.model_dump(mode="json", by_alias=True, exclude_none=True)
