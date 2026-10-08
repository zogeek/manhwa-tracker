import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildIngestionContract, INGESTION_CONTRACT_PATH, serializeIngestionContract } from './ingestion.contract.js';

describe('ingestion contract (JSON Schema)', () => {
  it('is in sync with the committed file consumed by the Python worker', async () => {
    const committed = await readFile(new URL(`../../../${INGESTION_CONTRACT_PATH}`, import.meta.url), 'utf8');

    // En cas d'échec : `pnpm contract:generate` à la racine, puis commiter les deux fichiers générés.
    expect(committed).toBe(serializeIngestionContract());
  });

  it('names every root schema and shared enum', () => {
    expect(Object.keys(buildIngestionContract().$defs ?? {})).toEqual([
      'ChapterKind',
      'ChapterQuality',
      'FinishRun',
      'HealthSample',
      'HealthStatus',
      'IngestBatch',
      'IngestChapter',
      'IngestManhwa',
      'ManhwaStatus',
      'ManhwaType',
      'RecordHealth',
      'RunOutcome',
      'StartRun',
      'TrackedSeries',
      'TrackedSeriesPage',
      'TrackedSeriesQuery',
    ]);
  });

  it('keeps semantic formats but drops the regexes Zod attaches to them', () => {
    const serialized = serializeIngestionContract();

    expect(serialized).toContain('"format": "uuid"');
    expect(serialized).toContain('"format": "date-time"');
    expect(serialized).not.toContain('"pattern"');
  });
});
