import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'esnext',
  outDir: 'dist',
  external: [
    '@hono/node-server',
    '@hono/swagger-ui',
    '@hono/zod-openapi',
    '@truefoundry/utils',
    'hono',
    'ulid',
    'winston',
    'yaml',
    'zod',
  ],
});
