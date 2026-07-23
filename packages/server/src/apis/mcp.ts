import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { extractErrorLogFields, isAuthRequired, McpConnectionError, RemoteMCP } from '@truefoundry/utils/core';
import type { Logger } from 'winston';
import { listMcpServersRoute, listMcpToolsRoute } from '../routes/mcpRoutes';
import type { McpStore } from '../store/McpStore';

export interface McpRouterDeps {
  mcpStore: McpStore;
  logger: Logger;
}

/** Omits keys whose value is `undefined` so wire objects satisfy JSONValue index signatures. */
function omitUndefinedEntries(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export function createMcpRouter(deps: McpRouterDeps) {
  const listMcpServersHandler: RouteHandler<typeof listMcpServersRoute> = c => {
    return c.json({ data: deps.mcpStore.list() }, 200);
  };

  // Live MCP `tools/list` call against the configured server, no selectors applied.
  const listMcpToolsHandler: RouteHandler<typeof listMcpToolsRoute> = async c => {
    const { name } = c.req.valid('param');
    const entry = deps.mcpStore.get(name);
    if (!entry) {
      return c.json({ error: { message: `MCP server not found: ${name}` } }, 404);
    }
    const remote = new RemoteMCP({
      id: name,
      name,
      url: entry.url,
      headers: deps.mcpStore.getHeaders(name),
      logger: deps.logger,
      signal: c.req.raw.signal,
    });
    try {
      const response = await remote.listTools();
      if (isAuthRequired(response)) {
        return c.json({ error: { message: `MCP server "${name}" requires authentication` } }, 401);
      }
      const data = response.result.tools.map(tool => omitUndefinedEntries({ ...tool }));
      return c.json({ data }, 200);
    } catch (error) {
      if (error instanceof McpConnectionError) {
        deps.logger.warn(`MCP tools/list failed for "${name}"`, extractErrorLogFields(error));
        if (error.statusCode === 401) {
          return c.json({ error: { message: error.message } }, 401);
        }
        return c.json({ error: { message: error.message } }, 502);
      }
      throw error;
    }
  };

  const router = new OpenAPIHono();
  router.openapi(listMcpServersRoute, listMcpServersHandler);
  router.openapi(listMcpToolsRoute, listMcpToolsHandler);
  return router;
}
