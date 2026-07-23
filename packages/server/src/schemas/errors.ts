/** Error response wire schema. */
import { z } from '@hono/zod-openapi';

export const RequestErrorResponseSchema = z
  .object({
    error: z.object({
      message: z.string(),
      type: z.string().optional(),
      code: z.string().nullable().optional(),
      param: z.string().nullable().optional(),
    }),
  })
  .openapi('RequestErrorResponse');

export type RequestErrorResponse = z.infer<typeof RequestErrorResponseSchema>;
