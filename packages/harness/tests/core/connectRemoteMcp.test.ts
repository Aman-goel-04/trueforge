import { McpConnectionError } from '../../src/core/errors';
import { connectRemoteMcp } from '../../src/core/mcp/remoteMcpClient';

// Records every transport type client.connect() was attempted with, in order.
const mockConnectAttempts: string[] = [];
// Per-test hook: throw to fail a given transport, return to succeed.
let mockConnectImpl: (type: string) => void = () => {};

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    onclose?: () => void;
    onerror?: (e: Error) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async connect(transport: any): Promise<void> {
      const type = transport.__type as string;
      mockConnectAttempts.push(type);
      mockConnectImpl(type);
    }
    async close(): Promise<void> {}
    async listTools(): Promise<{ tools: [] }> {
      return { tools: [] };
    }
    async callTool(): Promise<{ content: [] }> {
      return { content: [] };
    }
  },
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    sessionId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_url: URL, opts?: any) {
      this.sessionId = opts?.sessionId;
      (this as unknown as { __type: string }).__type = 'streamable-http';
    }
  },
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {
    constructor() {
      (this as unknown as { __type: string }).__type = 'sse';
    }
  },
}));

const baseParams = () => ({
  url: 'https://mcp.example.com/mcp',
  headers: {},
  signal: new AbortController().signal,
});

describe('connectRemoteMcp transport selection', () => {
  beforeEach(() => {
    mockConnectAttempts.length = 0;
    mockConnectImpl = () => {};
  });

  it('falls back to the other transport when the known hint is stale/wrong', async () => {
    // Hint says sse, but the server is actually streamable-http (sse connect fails).
    mockConnectImpl = type => {
      if (type === 'sse') throw new Error('not an SSE endpoint');
    };

    const conn = await connectRemoteMcp({ ...baseParams(), knownTransportType: 'sse' });

    expect(conn.transportType).toBe('streamable-http');
    // Hint tried first, then fell back to the remaining transport.
    expect(mockConnectAttempts).toEqual(['sse', 'streamable-http']);
  });

  it('uses the known hint directly when it works (no fallback attempt)', async () => {
    const conn = await connectRemoteMcp({ ...baseParams(), knownTransportType: 'sse' });

    expect(conn.transportType).toBe('sse');
    expect(mockConnectAttempts).toEqual(['sse']);
  });

  it('probes in order when there is no hint', async () => {
    mockConnectImpl = type => {
      if (type === 'streamable-http') throw new Error('no streamable-http');
    };

    const conn = await connectRemoteMcp(baseParams());

    expect(conn.transportType).toBe('sse');
    expect(mockConnectAttempts).toEqual(['streamable-http', 'sse']);
  });

  it('throws immediately on a 401 without trying the fallback transport', async () => {
    mockConnectImpl = () => {
      throw new Error('HTTP 401 Unauthorized');
    };

    await expect(connectRemoteMcp({ ...baseParams(), knownTransportType: 'streamable-http' })).rejects.toMatchObject({
      constructor: McpConnectionError,
      statusCode: 401,
    });
    expect(mockConnectAttempts).toEqual(['streamable-http']);
  });

  it('surfaces a session-expiry on the hinted transport without falling back (caller resets the session)', async () => {
    mockConnectImpl = () => {
      throw new Error('HTTP 404 session not found');
    };

    await expect(
      connectRemoteMcp({ ...baseParams(), knownTransportType: 'streamable-http', sessionId: 'sess-1' }),
    ).rejects.toMatchObject({ constructor: McpConnectionError });
    // Session-expiry short-circuits: no fallback to sse with a stale session.
    expect(mockConnectAttempts).toEqual(['streamable-http']);
  });
});
