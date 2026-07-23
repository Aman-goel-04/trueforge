import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'core/index': 'src/core/index.ts',
    'agentSession/index': 'src/agentSession/index.ts',
  },
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'esnext',
  outDir: 'dist',
  external: [
    '@daytona/sdk',
    '@hono/zod-openapi',
    '@modelcontextprotocol/sdk',
    '@nats-io/nats-core',
    '@opentelemetry/api',
    '@opentelemetry/core',
    'dedent',
    'openai',
    'ulid',
    'winston',
    'ws',
    'zod',
    'zod-to-json-schema',
  ],
});
