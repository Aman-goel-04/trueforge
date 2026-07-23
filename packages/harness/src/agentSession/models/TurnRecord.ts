import type { MCPServerInitInfo } from '../../core/events/eventSchemas';
import type { AgentThreadSnapshot } from '../../core/runtime/AgentThread.types';
import type { SandboxInfo } from '../../core/sandbox/Sandbox';
import type { TurnInputItem, TurnState } from '../schemas/turn';

/** Root thread id for every session. */
export const MAIN_THREAD_ID = 'main';

/**
 * Public wire / store shape — JSON-friendly `Record`, not `Map`, so every
 * backend can persist it directly. In-process runtime may still use Map;
 * adapt at the store/Session boundary.
 */
export interface TurnSnapshot {
  threads: Record<string, AgentThreadSnapshot>;
  mcp_servers?: Record<string, MCPServerInitInfo> | undefined;
  sandbox_info?: SandboxInfo | undefined;
}

export interface TurnRecord<TCustom extends object = Record<string, never>> {
  serialization_version: number;
  turn_id: string;
  session_id: string;
  first_turn_id: string;
  ancestor_ids: string[];
  previous_turn_id?: string | undefined;
  state: TurnState;
  input: TurnInputItem[];
  snapshot: TurnSnapshot;
  created_at: string;
  updated_at: string;
  custom?: TCustom | undefined;
}

/** Current serialization version for TurnRecord. */
export const TURN_SERIALIZATION_VERSION = 1;
