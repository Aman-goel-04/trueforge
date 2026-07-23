import type { ChatCompletionCreateParams, ChatCompletionCreateParamsStreaming } from 'openai/resources/chat';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from './LLMTypes';

export type AgentMetadata = Record<string, string>;

export interface ILLM {
  create(
    body: ChatCompletionCreateParamsStreaming,
  ): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown>;
  createNonStream(body: ChatCompletionCreateParams): Promise<RawAssistantMessageWithUsage>;
}
