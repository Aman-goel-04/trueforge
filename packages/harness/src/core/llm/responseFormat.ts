import { z } from '@hono/zod-openapi';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat';

/**
 * Wire/runtime response format (Zod). Kept in core so AgentDefinition and AgentSpec
 * share one type without agentSession → core inversion.
 * `passthrough()` lets unknown fields within a known `type` flow through to the LLM.
 */
export const ResponseFormatSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('text') }).passthrough(),
    z.object({ type: z.literal('json_object') }).passthrough(),
    z
      .object({
        type: z.literal('json_schema'),
        json_schema: z
          .object({
            name: z.string(),
            description: z.string().optional(),
            schema: z.record(z.string(), z.unknown()).optional(),
            strict: z.boolean().nullable().optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  ])
  .openapi('ResponseFormat');

export type ResponseFormat = z.infer<typeof ResponseFormatSchema>;

type OpenAIResponseFormat = NonNullable<ChatCompletionCreateParamsStreaming['response_format']>;

/**
 * Maps our wire ResponseFormat into the OpenAI SDK shape for the chat.completions body.
 * Field-by-field so exactOptionalPropertyTypes stays happy without assertions.
 */
export function toOpenAIResponseFormat(format: ResponseFormat): OpenAIResponseFormat {
  if (format.type === 'text') {
    return { type: 'text' };
  }
  if (format.type === 'json_object') {
    return { type: 'json_object' };
  }
  const { name, description, schema, strict } = format.json_schema;
  return {
    type: 'json_schema',
    json_schema: {
      name,
      ...(description !== undefined ? { description } : {}),
      ...(schema !== undefined ? { schema } : {}),
      ...(strict !== undefined ? { strict } : {}),
    },
  };
}
