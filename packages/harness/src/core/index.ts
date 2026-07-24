/**
 * Public agent execution harness.
 * Intentional consumer-facing exports only (production API).
 */

// Runtime
export type { AgentDefinition } from './runtime/AgentDefinition';
export { AgentThread } from './runtime/AgentThread';
export type { AgentInfo, AgentParent } from './runtime/AgentThread.types';
export { AgentThreadOrchestrator } from './runtime/AgentThreadOrchestrator';
export type { CreateDynamicSubAgentThread } from './runtime/CreateDynamicSubAgentThread';
export { isAgentInputUserMessage, isEmptyMessageContent, isFileContentPart } from './runtime/UserInputMessage';
export type { AgentInputUserMessage } from './runtime/UserInputMessage';

// Capability contracts
export type { AgentCapability } from './capabilities/AgentCapability';
export type {
  AgentContextProcessorOutput,
  AgentThreadExecutionContext,
  PostToolCallAgentContextProcessor,
  PreLLMEphemeralAgentContextProcessor,
} from './capabilities/AgentContextProcessor';

// Built-in factories
export { askUserQuestion } from './capabilities/builtins/AskUserQuestion';
export { contextCompaction } from './capabilities/builtins/ContextCompaction';
export { currentDateTime } from './capabilities/builtins/CurrentDateTime';
export { SUB_AGENT_IDENTITY, dynamicSubAgents } from './capabilities/builtins/DynamicSubAgents';
export { largeToolResponse } from './capabilities/builtins/LargeToolResponse';
export { openUI } from './capabilities/builtins/OpenUI';

// MCP contracts
export type { ApprovalDecision } from './events/schema';
export { ClientSideTool } from './mcp/ClientSideTool';
export { isAuthRequired, toolResultResponse } from './mcp/IMCPServer';
export type {
  AgentToolSchema,
  AuthRequiredResponse,
  CallToolResponse,
  IToolSet,
  ListToolsResponse,
  MCPAuthRequired,
  ToolSource,
} from './mcp/IMCPServer';
export { LocalToolMCP, defineTool } from './mcp/LocalToolMCP';
export type { ToolDefinition } from './mcp/LocalToolMCP';

// Remote MCP server, split into a shared, policy-free connection (`RemoteMCP`) and a per-agent policy
// wrapper (`ToolSet`). `RemoteMCP` connects itself from a `url` + `headers`; the networking helpers
// live in the harness-internal `remoteMcpClient` module.
export { RemoteMCP } from './mcp/RemoteMCP';
export type { RemoteMcpHeaders, ResolveHeadersResult } from './mcp/RemoteMCP';
export type { RemoteMcpConnection, RemoteMcpTransportType } from './mcp/remoteMcpClient';
export type { ToolSelectorConfig } from './mcp/ToolSelectorPolicy';
export { ToolSet } from './mcp/ToolSet';

// LLM contracts
export type { ILLM } from './llm/ILLM';
export type { CompletionUsage, LLMUserMessage } from './llm/LLMTypes';
export { OpenAILLM } from './llm/OpenAILLM';
export { ResponseFormatSchema, toOpenAIResponseFormat } from './llm/responseFormat';
export type { ResponseFormat } from './llm/responseFormat';

// Event contracts
export {
  EventType,
  MCPAuthRequiredEventSchema,
  MCPInitializeEventSchema,
  ModelMessageDeltaEventSchema,
  ModelMessageEventSchema,
  SandboxCreatedEventSchema,
  ThreadCreatedEventSchema,
  ThreadDoneEventSchema,
  ToolApprovalRequiredEventSchema,
  ToolResponseEventSchema,
  ToolResponseRequiredEventSchema,
  newEventId,
} from './events/schema';
export { InternalEventType } from './runtime/AgentThread.types';
export type { AgentThreadSendBatch, ContextMessage } from './runtime/AgentThread.types';
export type { AgentThreadMetrics } from './runtime/metrics';
export type { SandboxInfo } from './sandbox/Sandbox';

// Tracing
export type {
  AgentExecutionTrace,
  AgentLocalToolTrace,
  AgentRemoteMcpToolTrace,
  AgentTracing,
} from './tracing/AgentTracing';

// Errors / utils
export { AgentHarnessError, McpConnectionError } from './errors';
export { extractErrorLogFields } from './util/errorLogFields';

// Sandbox (concrete implementation; provider details exported for composition)
export {
  DaytonaSandboxProviderSettingsSchema,
  SandboxProviderSettingsSchema,
  createSandboxProvider,
} from './sandbox/provider/createSandboxProvider';
export type { CreateSandboxProviderInput, SandboxProviderSettings } from './sandbox/provider/createSandboxProvider';
export { DaytonaSandboxProvider } from './sandbox/provider/DaytonaProvider';
export type { SandboxProvider } from './sandbox/provider/Provider';
export { TFYSandboxProvider } from './sandbox/provider/TFYSandboxProvider';
export { Sandbox } from './sandbox/Sandbox';
