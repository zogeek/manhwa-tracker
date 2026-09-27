import { z } from 'zod';
import {
  finishRunSchema,
  ingestBatchSchema,
  recordHealthSchema,
  startRunSchema,
} from './ingestion.validator.js';

/**
 * Contrat `/api/ingest/*` exporté en JSON Schema : source unique de vérité pour les clients
 * non-TypeScript (le worker Python en génère ses modèles Pydantic). Les validateurs Zod restent
 * la référence ; ce fichier ne fait que les traduire.
 *
 * `io: 'input'` décrit ce que le client ENVOIE (avant les `transform`, ex. date ISO → `Date`).
 */
const contractSchemas = [startRunSchema, finishRunSchema, recordHealthSchema, ingestBatchSchema];

export const INGESTION_CONTRACT_PATH = 'contracts/ingestion.schema.json';

export function buildIngestionContract(): z.core.JSONSchema.BaseSchema {
  const definitions: Record<string, z.core.JSONSchema.JSONSchema> = {};
  for (const schema of contractSchemas) {
    const { $defs } = z.toJSONSchema(schema, {
      io: 'input',
      unrepresentable: 'throw',
      // Zod double chaque `format` (uuid, date-time) d'une regex interne : le `format` porte le sens,
      // et les générateurs (Pydantic) refusent une regex sur un UUID ou une date.
      override: ({ zodSchema, jsonSchema }) => {
        if (jsonSchema.format !== undefined) {
          delete jsonSchema.pattern;
        }
        // En mode `input`, Zod omet la valeur de `.default()` : on la réexpose pour que le client sache
        // qu'un champ absent vaut, par exemple, `[]` (et non `null`).
        if (zodSchema instanceof z.ZodDefault) {
          jsonSchema.default = zodSchema.def.defaultValue;
        }
      },
    });
    Object.assign(definitions, $defs);
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $comment: 'Contrat de /api/ingest/*. Généré par `pnpm contract:generate` (racine du repo), ne pas éditer.',
    // Racine = charge utile principale (un lot) ; sans racine typée, les générateurs produisent un modèle `Any`.
    $ref: '#/$defs/IngestBatch',
    // Ordre stable : le fichier commité ne change que si le contrat change.
    $defs: Object.fromEntries(Object.entries(definitions).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function serializeIngestionContract(): string {
  return `${JSON.stringify(buildIngestionContract(), null, 2)}\n`;
}
