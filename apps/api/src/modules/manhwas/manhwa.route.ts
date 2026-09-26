import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { AuthMiddleware } from '../../shared/middleware/auth.middleware.js';
import type { DiscoveryService } from '../discovery/discovery.service.js';
import { catalogSearchQuerySchema, importManhwaSchema } from '../discovery/discovery.validator.js';
import type { ManhwaService } from './manhwa.service.js';
import {
  createManhwaSchema,
  updateManhwaSchema,
  manhwaIdParamSchema,
} from './manhwa.validator.js';

/**
 * Catalogue : lecture publique, mutations réservées au rôle admin.
 * Exception : l'import depuis un catalogue externe est ouvert à tout utilisateur connecté
 * (il ne transmet qu'une référence, le contenu vient du fournisseur).
 */
export const createManhwaRoutes = (
  service: ManhwaService,
  discovery: DiscoveryService,
  { requireAuth, requireAdmin }: AuthMiddleware,
) =>
  new Hono<AppEnv>()
    .get('/', async (c) => {
      const manhwas = await service.getAll();
      return c.json({ data: manhwas }, 200);
    })
    // Déclarées AVANT `/:id` : sinon « search » serait lu comme un identifiant (et rejeté : UUID invalide).
    .get('/search', validate('query', catalogSearchQuerySchema), async (c) => {
      const result = await discovery.search(c.req.valid('query'));
      return c.json({ data: result }, 200);
    })
    .post('/import', requireAuth, validate('json', importManhwaSchema), async (c) => {
      const { manhwa, created } = await discovery.importManhwa(c.req.valid('json'), c.get('user').id);
      return created ? c.json({ data: manhwa }, 201) : c.json({ data: manhwa }, 200);
    })
    .get('/:id', validate('param', manhwaIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      const manhwa = await service.getById(id);
      return c.json({ data: manhwa }, 200);
    })
    .post('/', requireAdmin, validate('json', createManhwaSchema), async (c) => {
      const manhwa = await service.create(c.req.valid('json'), c.get('user').id);
      return c.json({ data: manhwa }, 201);
    })
    .patch(
      '/:id',
      requireAdmin,
      validate('param', manhwaIdParamSchema),
      validate('json', updateManhwaSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const manhwa = await service.update(id, c.req.valid('json'), c.get('user').id);
        return c.json({ data: manhwa }, 200);
      },
    )
    .delete('/:id', requireAdmin, validate('param', manhwaIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      await service.delete(id, c.get('user').id);
      return c.body(null, 204);
    });
