import type { AgentSpec } from '../schemas/agentSpec';

/**
 * Every Session / SessionRecord exposes a hydrated `agent_spec`. Persistence
 * may store the full blob or only a uri/id — an ISessionStore impl detail.
 * `getSession` MUST hydrate so callers (and Session.run) never see a bare
 * pointer; agent resolution stays inside the store. Callers rewrite the
 * binding via the updateSession patch.
 */
export interface SessionRecord<TCustom extends object = Record<string, never>> {
  session_id: string;
  /** Always hydrated on read. Source of `spec` in SessionHandle.run(). */
  agent_spec: AgentSpec;
  /**
   * Wire SessionSchema.title (nullable). Written via updateSession patch or
   * createTurn's update_session_title_if_not_exist (first write wins; caller derives).
   */
  title?: string | null | undefined;
  /**
   * Session tip — used for `previous_turn_id: 'auto'` resolution and turn
   * listing anchors. Advanced only by `createTurn` (atomic link).
   */
  last_turn_id?: string | undefined;
  created_at: string;
  updated_at: string;
  /**
   * Liveness clock (ms since epoch). The store bumps it on createSession,
   * updateSession, and createTurn — never on reads.
   */
  last_activity_timestamp_ms: number;
  custom?: TCustom | undefined;
}
