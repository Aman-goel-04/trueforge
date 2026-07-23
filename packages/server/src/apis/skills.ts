import { OpenAPIHono } from '@hono/zod-openapi';
import { listSkillsRoute } from '../routes/skillRoutes';
import type { SkillStore } from '../store/SkillStore';

export function createSkillsRouter(store: SkillStore) {
  const router = new OpenAPIHono();
  router.openapi(listSkillsRoute, c => c.json({ data: store.list() }, 200));
  return router;
}
