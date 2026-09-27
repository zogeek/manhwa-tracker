"""Classe de base des modèles générés (`contract.py`) : la politique de validation propre au worker.

Le JSON Schema décrit le contrat ; la façon de s'en servir reste une décision du worker :
- `extra="forbid"` : une coquille d'extracteur échoue ici, pas en 400 après des minutes de scraping ;
- `validate_by_name` : on construit en snake_case, on sérialise en camelCase (alias générés) ;
- `frozen` : un modèle validé ne peut plus être modifié en douce avant l'envoi.
"""

from pydantic import BaseModel, ConfigDict


class ContractModel(BaseModel):
    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True, extra="forbid", frozen=True)
