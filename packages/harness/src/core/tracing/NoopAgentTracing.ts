import type { AgentThreadMetric } from '../llm/metrics';
import type { AgentExecutionTrace, AgentLocalToolTrace, AgentRemoteMcpToolTrace, AgentTracing } from './AgentTracing';

class NoopAgentExecutionTrace implements AgentExecutionTrace {
  runInContext<T>(operation: () => T): T {
    return operation();
  }

  startSubAgent(_name: string, _input: string): AgentExecutionTrace {
    return this;
  }

  setOutput(_output: string): void {}

  setMetrics(_metrics: AgentThreadMetric): void {}

  setError(_error: unknown): void {}

  setSuccess(): void {}

  end(): void {}
}

class NoopAgentLocalToolTrace implements AgentLocalToolTrace {
  setOutput(_output: string): void {}

  setSandboxId(_sandboxId: string): void {}
}

class NoopAgentRemoteMcpToolTrace implements AgentRemoteMcpToolTrace {
  setOutput(_output: string): void {}

  setNumberOfTools(_count: number): void {}
}

const NOOP_EXECUTION_TRACE = new NoopAgentExecutionTrace();
const NOOP_LOCAL_TOOL_TRACE = new NoopAgentLocalToolTrace();
const NOOP_REMOTE_MCP_TOOL_TRACE = new NoopAgentRemoteMcpToolTrace();

export const NOOP_AGENT_TRACING: AgentTracing = {
  async withInitSpan<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  },

  startRootSpan(_input: string): AgentExecutionTrace {
    return NOOP_EXECUTION_TRACE;
  },

  async withLocalToolSpan<T>(
    _input: {
      displayName: string;
      toolName: string;
      input?: string | undefined;
      enabled: boolean;
    },
    operation: (span: AgentLocalToolTrace) => Promise<T>,
  ): Promise<T> {
    return operation(NOOP_LOCAL_TOOL_TRACE);
  },

  async withRemoteMcpToolSpan<T>(
    _input: {
      method: string;
      serverName: string;
      serverId: string;
      serverUrl: string;
      toolName?: string | undefined;
      input?: string | undefined;
      enabled: boolean;
    },
    operation: (span: AgentRemoteMcpToolTrace) => Promise<T>,
  ): Promise<T> {
    return operation(NOOP_REMOTE_MCP_TOOL_TRACE);
  },
};
