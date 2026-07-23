import type { CompletionUsage } from './LLMTypes';
import { getEmptyUsage } from './LLMTypes';
import { mergeUsage } from './usage';

export interface AgentThreadMetric {
  iterations: number;
  total_tool_calls: number;
  total_summarizations: number;
  usage: CompletionUsage;
  total_sub_agents: number;
}

export interface AgentThreadMetrics {
  total: AgentThreadMetric;
}

export function getEmptyMetric(): AgentThreadMetric {
  return {
    iterations: 0,
    total_tool_calls: 0,
    total_summarizations: 0,
    usage: getEmptyUsage(),
    total_sub_agents: 0,
  };
}

export function addMetrics(target: AgentThreadMetric, source: AgentThreadMetric): void {
  target.iterations += source.iterations;
  target.total_tool_calls += source.total_tool_calls;
  target.total_summarizations += source.total_summarizations;
  target.total_sub_agents += source.total_sub_agents;
  target.usage = mergeUsage(target.usage, source.usage);
}
