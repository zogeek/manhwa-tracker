import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import { PayloadTooLargeError } from '../../shared/lib/errors.js';
import type { ApiKeyMiddleware } from '../../shared/middleware/api-key.middleware.js';
import type { IngestionService } from './ingestion.service.js';
import {
  finishRunSchema,
  idempotencyHeaderSchema,
  ingestBatchSchema,
  recordHealthSchema,
  runIdParamSchema,
  startRunSchema,
} from './ingestion.validator.js';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * API machine-à-machine du worker de scraping (clé `x-api-key`, jamais de session utilisateur).
 * Tout le routeur est protégé : aucune route ne peut être ajoutée ici sans la clé.
 */
export const createIngestionRoutes = (service: IngestionService, { requireApiKey }: ApiKeyMiddleware) =>
  new Hono<AppEnv>()
    .use('*', requireApiKey)
    .use(
      '*',
      bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: () => {
          throw new PayloadTooLargeError(`Body exceeds ${MAX_BODY_BYTES} bytes`);
        },
      }),
    )
    .post(
      '/batches',
      validate('header', idempotencyHeaderSchema),
      validate('json', ingestBatchSchema),
      async (c) => {
        const { 'idempotency-key': idempotencyKey } = c.req.valid('header');
        const { replayed, result } = await service.ingestBatch(idempotencyKey, c.req.valid('json'));
        if (replayed) {
          c.header('Idempotent-Replayed', 'true');
          return c.json({ data: result }, 200);
        }
        return c.json({ data: result }, 201);
      },
    )
    .post('/runs', validate('json', startRunSchema), async (c) => {
      const run = await service.startRun(c.req.valid('json'));
      return c.json({ data: run }, 201);
    })
    .patch('/runs/:id', validate('param', runIdParamSchema), validate('json', finishRunSchema), async (c) => {
      const { id } = c.req.valid('param');
      const run = await service.finishRun(id, c.req.valid('json'));
      return c.json({ data: run }, 200);
    })
    .post('/health', validate('json', recordHealthSchema), async (c) => {
      const recorded = await service.recordHealth(c.req.valid('json'));
      return c.json({ data: { recorded } }, 201);
    });
