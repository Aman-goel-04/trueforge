import { OpenAPIHono } from '@hono/zod-openapi';
import { listModelsRoute } from '../routes/modelRoutes';
import type { ModelStore } from '../store/ModelStore';

export function createModelsRouter(store: ModelStore) {
  const router = new OpenAPIHono();
  router.openapi(listModelsRoute, c => c.json({ data: store.list() }, 200));
  return router;
}
