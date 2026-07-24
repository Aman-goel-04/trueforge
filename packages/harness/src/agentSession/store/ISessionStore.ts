import type { MCPServerInitInfo, ThreadOverwriteContextEvent } from '../../core/events/eventSchemas';
import type { WithRegisteredPassthrough } from '../../core/events/PassthroughEvents';
import type { CompletionUsage } from '../../core/llm/LLMTypes';
import type {
  AgentThreadSnapshot,
  ContextMessage,
  SubAgentCompletionMarker,
} from '../../core/runtime/AgentThread.types';
import type { SandboxInfo } from '../../core/sandbox/Sandbox';
import type { SessionRecord } from '../models/SessionRecord';
import type { TurnRecord } from '../models/TurnRecord';
import type { AgentSpec } from '../schemas/agentSpec';
import type { TurnCreatedEvent, TurnDoneEvent, TurnEvent } from '../schemas/events';
import type { TokenPagination } from '../schemas/pagination';
import type { TerminalTurnState } from '../schemas/turn';

/**
 * Session/turn persistence contract. Pure durability: no streaming, SSE, or
 * subscription members. Turn-scoped ops take session_id (membership check).
 * Capability durability goes through patchThreadCapabilityState only. Agent
 * binding is session-scoped: reads always return a hydrated agent_spec even
 * if the backend persists a uri/id.
 */
export interface ISessionStore<
  TSessionCustom extends object = Record<string, never>,
  TTurnCustom extends object = Record<string, never>,
> {
  /**
   * Accepts a hydrated AgentSpec. Impl may persist the blob and/or a uri/id derived
   * from it — callers do not pass a bare pointer through this API.
   * Sets `last_activity_timestamp_ms` (= now) on create.
   */
  createSession(input: {
    tenant_name: string;
    session_id: string;
    agent_spec: AgentSpec;
    custom?: TSessionCustom | undefined;
  }): Promise<void>;

  /**
   * MUST return SessionRecord with `agent_spec` fully hydrated, even if the backend
   * only stores a uri/id (or named-agent ref). Hydration is the store's job — harness
   * and SessionHandle.run never resolve agents themselves.
   * Does **not** bump `last_activity_timestamp_ms` (read path).
   */
  getSession(input: { tenant_name: string; session_id: string }): Promise<SessionRecord<TSessionCustom> | undefined>;

  /**
   * PATCH semantics — update only the provided fields:
   * - agent_spec: rewrite binding (full spec and/or backing uri/id). Next getSession hydrates.
   * - title: set/replace the session title.
   * Bumps `last_activity_timestamp_ms` (= now). Same liveness rule applies to any
   * future session-update fields: update session ⇒ touch activity.
   */
  updateSession(input: {
    tenant_name: string;
    session_id: string;
    agent_spec?: AgentSpec | undefined;
    title?: string | undefined;
  }): Promise<void>;

  /**
   * Paginated list of the tenant's sessions ordered by `created_at`
   * (`order` defaults to `desc`). `start_timestamp` / `end_timestamp` are
   * inclusive ISO-8601 bounds on `created_at`.
   * Does **not** bump `last_activity_timestamp_ms` (read path).
   */
  listSessions(input: {
    tenant_name: string;
    limit: number;
    page_token?: string | undefined;
    order?: 'asc' | 'desc' | undefined;
    start_timestamp?: string | undefined;
    end_timestamp?: string | undefined;
  }): Promise<{ data: SessionRecord<TSessionCustom>[]; pagination: TokenPagination }>;

  /**
   * Creates the turn AND advances `session.last_turn_id`.
   *
   * Atomicity (store contract): insert turn + set `last_turn_id` (+ session
   * turn-list append if the backend has one) MUST be one atomic unit per
   * session. Concurrent createTurn on the same session must not drop a turn
   * row or leave `last_turn_id` pointing at a turn that was never created.
   * The implementation supplies the mechanism (session lock, row lock/tx, …).
   *
   * Also bumps `session.last_activity_timestamp_ms` in that same atomic unit.
   *
   * Fork semantics for `turn.previous_turn_id`:
   * - `undefined` — new root turn (no parent); always allowed.
   * - string — must reference an **existing** turn in this session (fork/chain
   *   from that turn). Tip-equality is NOT required; concurrent forks from the
   *   same tip both succeed. Unknown id → not-found.
   * `last_turn_id` always advances to the new turn in the same atomic unit.
   *
   * `update_session_title_if_not_exist`: when set AND `session.title` is
   * unset/null, set it in the same atomic unit; an existing title is NEVER
   * overwritten (first write wins). The caller derives the value; the store
   * only conditionally sets it.
   */
  createTurn(input: {
    tenant_name: string;
    turn: TurnRecord<TTurnCustom>;
    update_session_title_if_not_exist?: string | undefined;
  }): Promise<void>;

  /** Returns the turn record, or undefined if not found in this session. */
  getTurn(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
  }): Promise<TurnRecord<TTurnCustom> | undefined>;

  /** Paginated list of the session's turn records, stable ordering. */
  listTurns(input: {
    tenant_name: string;
    session_id: string;
    limit: number;
    page_token?: string | undefined;
  }): Promise<{ data: TurnRecord<TTurnCustom>[]; pagination: TokenPagination }>;

  /**
   * Writes the terminal state. Store contract — **first terminal write wins**:
   * - Allowed: `running` → `done` | `cancelled` | `error`.
   * - Rejected with **409** (or equivalent conflict): any write when status is already
   *   terminal — including done→cancelled, cancelled→done, error→*, terminal→running.
   * - Missing turn → 404 / not-found.
   *
   * Check under the same concurrency control as other turn mutations (lock/CAS) —
   * not a racy read-then-write outside the critical section.
   */
  updateTurnState(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    state: TerminalTurnState;
  }): Promise<void>;

  /**
   * Durable event log for the turn. MUST include lifecycle rows: a
   * `TurnCreatedEvent` at the start of the stream and a terminal `TurnDoneEvent`
   * (or its cancelled/error shape) at the end. Every turn written through this
   * API persists lifecycle in the stream — implementations never synthesize
   * missing created/done rows on read.
   */
  appendToEvents(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    events: WithRegisteredPassthrough<TurnEvent | TurnCreatedEvent | TurnDoneEvent>[];
  }): Promise<void>;

  /** Adds thread snapshots to the turn (sub-agent spawns). */
  addThreads(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    threads: AgentThreadSnapshot[];
  }): Promise<void>;

  /** Removes threads from the turn by id. */
  removeThreads(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    thread_ids: string[];
  }): Promise<void>;

  /** Appends messages to a thread's context; optionally updates usage / completion marker. */
  appendToThreadContext(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    thread_id: string;
    context: ContextMessage[];
    current_context_usage?: CompletionUsage | undefined;
    completion?: SubAgentCompletionMarker | undefined;
  }): Promise<void>;

  /** Replaces a thread's context wholesale (context-overwrite event). */
  overwriteThreadContext(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    event: ThreadOverwriteContextEvent;
  }): Promise<void>;

  /** Patches the turn snapshot's MCP server init info (by source id). */
  patchMCPServers(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    mcp_servers: MCPServerInitInfo[];
  }): Promise<void>;

  /** Patches the turn snapshot's sandbox info (id for cross-turn reattach). */
  patchSandboxInfo(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    sandbox_info: SandboxInfo;
  }): Promise<void>;

  /** Generic capability KV — store has zero Plan/feature knowledge. */
  patchThreadCapabilityState(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    thread_id: string;
    key: string;
    state: unknown;
  }): Promise<void>;

  /** Paginated read of one turn's persisted events, insertion order (asc default). */
  listTurnEvents(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    limit: number;
    page_token?: string | undefined;
    order?: 'asc' | 'desc' | undefined;
  }): Promise<{
    data: WithRegisteredPassthrough<TurnEvent | TurnCreatedEvent | TurnDoneEvent>[];
    pagination: TokenPagination;
  }>;

  /**
   * Paginated session-wide feed of persisted events across turns, including
   * turn.created / turn.done lifecycle rows. Reads only — never synthesizes.
   *
   * Includes events from **running** turns (the HTTP layer may 409 separately;
   * that is not store semantics). Ordering: newest-first across the flattened
   * feed. `last_turn_id` anchors the window to that turn plus its ancestors
   * (oldest first). `ancestor_ids` may be only the previous N ancestors and
   * need not reach the root — implementations that need the full chain must
   * spill through older turns' own `ancestor_ids`. Sibling branches from forks
   * are excluded; omit `last_turn_id` to use the full session turn list.
   */
  listSessionEvents(input: {
    tenant_name: string;
    session_id: string;
    limit: number;
    page_token?: string | undefined;
    last_turn_id?: string | undefined;
  }): Promise<{
    data: { turn_id: string; event: TurnCreatedEvent | TurnDoneEvent | TurnEvent }[];
    pagination: TokenPagination;
  }>;
}
