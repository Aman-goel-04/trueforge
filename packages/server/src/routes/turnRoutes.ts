/**
 * Turn route definitions (mounted at /v1/sessions). Creating a turn responds
 * with a Server-Sent Events stream; a running turn can be re-subscribed to
 * with resume support. Handlers are registered in apis/turns.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { TurnStreamingEventSchema } from '../schemas/events';
import { CreateTurnRequestSchema, SubscribeTurnRequestSchema } from '../schemas/turn';
import { SessionIdParamsSchema } from './sessionRoutes';

const SESSIONS_TAG = 'Sessions';

export const TurnIdParamsSchema = SessionIdParamsSchema.extend({
  turnId: z.string().min(1).describe('Turn identifier.'),
});

export const createTurnRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/turns',
  tags: [SESSIONS_TAG],
  summary: 'Create a turn in a session',
  description: `Start or continue a turn within a session. Responds with a Server-Sent Events stream.
Use \`previous_turn_id\` to chain to the session's last turn (defaults to \`auto\`).`,
  request: {
    params: SessionIdParamsSchema,
    body: {
      content: { 'application/json': { schema: CreateTurnRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'text/event-stream': {
          schema: TurnStreamingEventSchema,
        },
      },
      description: 'Server-Sent Events stream of turn events.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session or prior turn not found.',
    },
    412: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Requested action cannot be performed on the session because it is no longer usable.',
    },
  },
});

export const subscribeTurnRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/turns/{turnId}/subscribe',
  tags: [SESSIONS_TAG],
  summary: 'Subscribe to a running turn',
  description:
    'Subscribe to the live SSE stream for a turn. Pass `after_sequence_number` to resume after a disconnect (exclusive — events after this sequence number are replayed).',
  request: {
    params: TurnIdParamsSchema,
    body: {
      content: { 'application/json': { schema: SubscribeTurnRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'text/event-stream': {
          schema: TurnStreamingEventSchema,
        },
      },
      description: 'Server-Sent Events stream of turn events (deltas and lifecycle).',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Turn not found.',
    },
    412: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Cannot subscribe — the live stream no longer exists.',
    },
  },
});
