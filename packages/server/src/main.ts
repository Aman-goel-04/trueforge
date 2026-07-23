/**
 * Server entry point: validates config, loads the YAML stores, wires the
 * in-memory session runtime and starts the HTTP server. Any config or store
 * error aborts startup.
 */
import { serve } from '@hono/node-server';
import winston from 'winston';

try {
  const [
    { createServerApp },
    { default: configuration },
    { ModelStore },
    { McpStore },
    { SkillStore },
    { Sessions, InMemorySessionStore },
    { ActiveTurnRegistry },
    { createServerSandboxFactory },
  ] = await Promise.all([
    import('./app'),
    import('./config/config'),
    import('./store/ModelStore'),
    import('./store/McpStore'),
    import('./store/SkillStore'),
    import('@truefoundry/utils/agent-session'),
    import('./runtime/activeTurns'),
    import('./runtime/sandboxFactory'),
  ]);

  // Console logger shared by the server runtime (harness components require one).
  const logger = winston.createLogger({
    level: process.env['LOG_LEVEL'] ?? 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
  });

  const sessionStore = new InMemorySessionStore();
  // Throws on malformed SANDBOX_SETTINGS; undefined when sandbox is not configured.
  const sandboxFactory = createServerSandboxFactory({ logger });
  const app = createServerApp({
    modelStore: ModelStore.load(),
    mcpStore: McpStore.load(),
    skillStore: SkillStore.load(),
    sessionStore,
    sessions: new Sessions({ sessionStore }),
    activeTurns: new ActiveTurnRegistry(),
    ...(sandboxFactory ? { sandboxFactory } : {}),
    logger,
  });

  const server = serve({ fetch: app.fetch, port: configuration.PORT }, info => {
    console.log(`Agent server listening on http://localhost:${info.port} (docs at /docs)`);
  });

  server.on('error', error => {
    console.error('Failed to start server:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
} catch (error) {
  console.error('Failed to start server:', error instanceof Error ? error.message : error);
  process.exit(1);
}
