import { Hono } from 'hono';
import { ADMIN_ROLE, hasRole } from '../../shared/auth/index.js';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { AuthMiddleware } from '../../shared/middleware/auth.middleware.js';
import type { ManhwaSourceService } from './manhwa-source.service.js';
import { manhwaSourceParamSchema, updateManhwaSourceUrlSchema } from './manhwa-source.validator.js';

/** Sous-ressource `/manhwas/:manhwaId/sources/:sourceId` : le lien d'une œuvre avec une source. */
export const createManhwaSourceRoutes = (service: ManhwaSourceService, { requireAuth }: AuthMiddleware) =>
  new Hono<AppEnv>().patch(
    '/:manhwaId/sources/:sourceId',
    requireAuth,
    validate('param', manhwaSourceParamSchema),
    validate('json', updateManhwaSourceUrlSchema),
    async (c) => {
      const { manhwaId, sourceId } = c.req.valid('param');
      const user = c.get('user');
      const link = await service.updateUrl(manhwaId, sourceId, c.req.valid('json'), {
        id: user.id,
        isAdmin: hasRole(user, ADMIN_ROLE),
      });
      return c.json({ data: link }, 200);
    },
  );
