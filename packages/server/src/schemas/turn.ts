/** Server-only turn wire schemas (SSE resume / cancel). Core turn schemas live in agentSession. */
import { z } from '@hono/zod-openapi';

export { CreateTurnRequestSchema } from '@truefoundry/utils/agent-session';

export const SubscribeTurnRequestSchema = z
  .object({
    after_sequence_number: z.number().int().nonnegative().optional(),
  })
  .openapi('SubscribeTurnRequest');

export const CancelSessionRequestSchema = z.object({}).openapi('CancelSessionRequest');
export const CancelSessionResponseSchema = z.object({}).openapi('CancelSessionResponse');
