import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { INGESTION_CONTRACT_PATH, serializeIngestionContract } from '../modules/ingestion/ingestion.contract.js';

// Régénère le JSON Schema du contrat d'ingestion, puis `pnpm --filter scraper contract:generate`
// en dérive les modèles Python (ou `pnpm contract:generate` à la racine pour les deux).
await mkdir(dirname(INGESTION_CONTRACT_PATH), { recursive: true });
await writeFile(INGESTION_CONTRACT_PATH, serializeIngestionContract());
console.log(`Contrat écrit dans apps/api/${INGESTION_CONTRACT_PATH}`);
