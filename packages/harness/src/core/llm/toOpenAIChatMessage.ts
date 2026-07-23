import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat';
import type { LLMContextMessage } from '../runtime/AgentThread.types';
import type { LLMUserMessage } from './LLMTypes';

/**
 * Maps harness context messages to the OpenAI chat message param shape.
 * Strips `tool_info` from assistant tool_calls; omits empty `tool_calls`.
 * Built field-by-field for exactOptionalPropertyTypes (no assertions).
 */
export function toOpenAIChatMessage(msg: LLMContextMessage): ChatCompletionMessageParam {
  if (msg.role === 'user') {
    return { role: 'user', content: toOpenAIUserContent(msg.content) };
  }

  if (msg.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: msg.tool_call_id,
      content: msg.content,
    };
  }

  // assistant
  const content =
    msg.content !== undefined && msg.content !== null ? { content: msg.content } : {};
  const refusal =
    msg.refusal !== undefined && msg.refusal !== null ? { refusal: msg.refusal } : {};
  const name = msg.name !== undefined ? { name: msg.name } : {};

  if (!msg.tool_calls?.length) {
    return { role: 'assistant', ...content, ...refusal, ...name };
  }

  return {
    role: 'assistant',
    ...content,
    ...refusal,
    ...name,
    tool_calls: msg.tool_calls.map(toOpenAIToolCall),
  };
}

function toOpenAIToolCall(tc: {
  id: string;
  function: { name: string; arguments: string };
}): ChatCompletionMessageToolCall {
  return {
    id: tc.id,
    type: 'function',
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
    },
  };
}

function toOpenAIUserContent(content: LLMUserMessage['content']): string | ChatCompletionContentPart[] {
  if (typeof content === 'string') {
    return content;
  }

  const parts: ChatCompletionContentPart[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.type === 'image_url') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: part.image_url.url,
          ...(part.image_url.detail !== undefined ? { detail: part.image_url.detail } : {}),
        },
      });
      continue;
    }
    if (part.type === 'input_audio') {
      parts.push({
        type: 'input_audio',
        input_audio: {
          data: part.input_audio.data,
          format: part.input_audio.format,
        },
      });
      continue;
    }
    parts.push({
      type: 'file',
      file: {
        ...(part.file.file_data !== undefined ? { file_data: part.file.file_data } : {}),
        ...(part.file.file_id !== undefined ? { file_id: part.file.file_id } : {}),
        ...(part.file.filename !== undefined ? { filename: part.file.filename } : {}),
      },
    });
  }
  return parts;
}
