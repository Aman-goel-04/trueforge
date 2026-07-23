import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { context, propagation } from '@opentelemetry/api';
import { McpConnectionError } from '../errors';
import { withTimeout } from '../util/promiseUtils';
import type { ToolSchema } from './IMCPServer';

/** Networking for remote (url-based) MCP servers, kept separate so it can be mocked in tests. */

export type RemoteMcpTransportType = 'streamable-http' | 'sse';

export interface RemoteMcpConnection {
  readonly transportType: RemoteMcpTransportType;
  /** Session id for a stateful server, or null for a stateless one. */
  readonly sessionId: string | null;
  listTools(cursor?: string): Promise<{ tools: ToolSchema[]; nextCursor?: string }>;
  callTool(params: CallToolRequest['params']): Promise<CallToolResult>;
  close(): Promise<void>;
}

type McpTransport = StreamableHTTPClientTransport | SSEClientTransport;

const CLIENT_INFO = { name: 'tfy-agent-mcp-client', version: '1.0.0' } as const;
const TRANSPORT_PROBE_ORDER: RemoteMcpTransportType[] = ['streamable-http', 'sse'];

export const REQUEST_TIMEOUT_MS = 1_800_000;
export const CONNECT_TIMEOUT_MS = 30_000;

class McpClientWithTimeout extends Client {
  constructor() {
    super(CLIENT_INFO, { capabilities: {} });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override request(req: any, schema: any, options?: any): Promise<any> {
    return super.request(req, schema, { ...options, timeout: REQUEST_TIMEOUT_MS });
  }
}

function createTransport(
  type: RemoteMcpTransportType,
  url: URL,
  headers: Record<string, string>,
  sessionId?: string,
): McpTransport {
  const requestInit = { headers };
  if (type === 'streamable-http') {
    return new StreamableHTTPClientTransport(url, { requestInit, ...(sessionId !== undefined ? { sessionId } : {}) });
  }
  return new SSEClientTransport(url, { requestInit });
}

export function isSessionExpiredError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('code' in error && error.code === 404) return true;
  return error.message.includes('HTTP 404') || error.message.toLowerCase().includes('session');
}

function isAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('code' in error && error.code === 401) return true;
  return error.message.includes('HTTP 401');
}

/** Inject the active otel trace context so each request propagates its span. */
function stampTraceHeaders(headers: Record<string, string>): void {
  propagation.inject(context.active(), headers);
}

function getTransportSessionId(transport: McpTransport): string | null {
  return transport instanceof StreamableHTTPClientTransport ? (transport.sessionId ?? null) : null;
}

function toConnectError(error: unknown): McpConnectionError {
  if (error instanceof McpConnectionError) return error;
  if (isAuthError(error)) {
    return new McpConnectionError('upstream returned 401 Unauthorized (check x-tfy-mcp-headers credentials)', 401, {
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new McpConnectionError(message, 502, { cause: error });
}

function buildConnection(
  client: McpClientWithTimeout,
  transport: McpTransport,
  transportType: RemoteMcpTransportType,
  headers: Record<string, string>,
  requestOptions: { signal: AbortSignal },
): RemoteMcpConnection {
  return {
    transportType,
    sessionId: getTransportSessionId(transport),
    listTools: async (cursor?: string) => {
      stampTraceHeaders(headers);
      const response = await client.listTools(cursor ? { cursor } : undefined, requestOptions);
      return { tools: response.tools, ...(response.nextCursor !== undefined ? { nextCursor: response.nextCursor } : {}) };
    },
    callTool: async (callParams: CallToolRequest['params']): Promise<CallToolResult> => {
      stampTraceHeaders(headers);
      return (await client.callTool(callParams, undefined, requestOptions)) as CallToolResult;
    },
    close: async (): Promise<void> => {
      await client.close().catch(() => {});
    },
  };
}

/**
 * Connect to a remote MCP server, keeping the first transport that connects. `sessionId` is passed to
 * every attempt so a stateful session resumes in place instead of opening a throwaway one.
 *
 * `knownTransportType` is a hint (from a prior connect / persisted state): it's tried first for a fast
 * path, but on failure we still fall back to probing the remaining transports, so a stale or wrong
 * hint (server switched transports, bad resume data) self-heals instead of failing every turn.
 */
export async function connectRemoteMcp(params: {
  url: string;
  headers: Record<string, string>;
  sessionId?: string | undefined;
  knownTransportType?: RemoteMcpTransportType | undefined;
  connectTimeoutMs?: number | undefined;
  signal: AbortSignal;
  onClose?: () => void | undefined;
  onError?: (error: Error) => void | undefined;
}): Promise<RemoteMcpConnection> {
  const url = new URL(params.url);
  const requestOptions = { signal: params.signal };
  const candidates = params.knownTransportType
    ? [params.knownTransportType, ...TRANSPORT_PROBE_ORDER.filter(t => t !== params.knownTransportType)]
    : TRANSPORT_PROBE_ORDER;
  const failures: { transport: RemoteMcpTransportType; error: string }[] = [];

  for (const transportType of candidates) {
    const transport = createTransport(transportType, url, params.headers, params.sessionId);
    const client = new McpClientWithTimeout();
    try {
      stampTraceHeaders(params.headers);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exactOptionalPropertyTypes mismatch between SDK Transport interface and StreamableHTTPClientTransport.sessionId
      await withTimeout(
        client.connect(transport as any, requestOptions),
        params.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
        transportType,
      );
    } catch (error) {
      await client.close().catch(() => {});
      if (isAuthError(error)) throw toConnectError(error);
      // A session-expired error means the transport is right but the session is stale: surface it so
      // the caller reconnects fresh instead of falling through to a different transport.
      if (params.sessionId && isSessionExpiredError(error)) throw toConnectError(error);
      failures.push({ transport: transportType, error: error instanceof Error ? error.message.trim() : String(error) });
      continue;
    }

    // Set on the client (not the transport) so the SDK's own onclose/onerror cleanup still runs; the
    // SDK invokes these from inside it. Only wired on the kept connection, so failed attempts stay quiet.
    client.onclose = () => params.onClose?.();
    client.onerror = error => params.onError?.(error);
    return buildConnection(client, transport, transportType, params.headers, requestOptions);
  }

  throw new McpConnectionError(`failed to connect (tried ${candidates.join(', ')}): ${JSON.stringify(failures)}`, 502);
}
