import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { AuthMiddleware } from '../../shared/middleware/auth.middleware.js';
import type { TaxonomyService } from './taxonomy.service.js';
import {
  createTermSchema,
  createVocabularySchema,
  manhwaIdParamSchema,
  manhwaTermParamSchema,
  tagManhwaSchema,
  termIdParamSchema,
  updateTermSchema,
  vocabularySlugParamSchema,
} from './taxonomy.validator.js';

/** Taxonomie : lecture publique, mutations réservées au rôle admin. */
export const createTaxonomyRoutes = (service: TaxonomyService, { requireAdmin }: AuthMiddleware) =>
  new Hono<AppEnv>()
    .get('/vocabularies', async (c) => {
      const vocabularies = await service.getVocabularies();
      return c.json({ data: vocabularies }, 200);
    })
    .post('/vocabularies', requireAdmin, validate('json', createVocabularySchema), async (c) => {
      const vocabulary = await service.createVocabulary(c.req.valid('json'));
      return c.json({ data: vocabulary }, 201);
    })
    .get('/vocabularies/:slug/terms', validate('param', vocabularySlugParamSchema), async (c) => {
      const { slug } = c.req.valid('param');
      const terms = await service.getTerms(slug);
      return c.json({ data: terms }, 200);
    })
    .post('/terms', requireAdmin, validate('json', createTermSchema), async (c) => {
      const term = await service.createTerm(c.req.valid('json'));
      return c.json({ data: term }, 201);
    })
    .patch(
      '/terms/:id',
      requireAdmin,
      validate('param', termIdParamSchema),
      validate('json', updateTermSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const term = await service.updateTerm(id, c.req.valid('json'));
        return c.json({ data: term }, 200);
      },
    )
    .delete('/terms/:id', requireAdmin, validate('param', termIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      await service.deleteTerm(id);
      return c.body(null, 204);
    })
    .get('/manhwas/:manhwaId/terms', validate('param', manhwaIdParamSchema), async (c) => {
      const { manhwaId } = c.req.valid('param');
      const tags = await service.getManhwaTags(manhwaId);
      return c.json({ data: tags }, 200);
    })
    .put(
      '/manhwas/:manhwaId/terms/:termId',
      requireAdmin,
      validate('param', manhwaTermParamSchema),
      validate('json', tagManhwaSchema),
      async (c) => {
        const { manhwaId, termId } = c.req.valid('param');
        const tag = await service.tagManhwa(manhwaId, termId, c.req.valid('json'));
        return c.json({ data: tag }, 200);
      },
    )
    .delete('/manhwas/:manhwaId/terms/:termId', requireAdmin, validate('param', manhwaTermParamSchema), async (c) => {
      const { manhwaId, termId } = c.req.valid('param');
      await service.untagManhwa(manhwaId, termId);
      return c.body(null, 204);
    });
