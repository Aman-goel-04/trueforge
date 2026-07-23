import type { MCPServerInitInfo, ThreadOverwriteContextEvent } from '../../core/events/eventSchemas';
import type { RegisteredPassthroughEvent } from '../../core/events/PassthroughEvents';
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
import type { ISessionStore } from './ISessionStore';
import { SessionStoreConflictError, SessionStoreNotFoundError } from './SessionStoreErrors';

type StoredEvent = TurnEvent | TurnCreatedEvent | TurnDoneEvent | RegisteredPassthroughEvent;

interface StoredSession<TSessionCustom extends object> {
  record: SessionRecord<TSessionCustom>;
  turnIds: string[];
}

function deepCopy<T>(value: T): T {
  return structuredClone(value);
}

function sessionKey(tenant: string, sessionId: string): string {
  return `${tenant}:${sessionId}`;
}

function turnKey(tenant: string, sessionId: string, turnId: string): string {
  return `${tenant}:${sessionId}:${turnId}`;
}

function encodeOffset(offset: number): string {
  return String(offset);
}

function decodeOffset(token: string | undefined): number {
  if (token === undefined || token === '') return 0;
  const n = Number(token);
  if (!Number.isInteger(n) || n < 0) {
    throw new SessionStoreConflictError(`Invalid page_token: ${token}`);
  }
  return n;
}

function paginate<T>(items: T[], limit: number, pageToken?: string): { data: T[]; pagination: TokenPagination } {
  const offset = decodeOffset(pageToken);
  const slice = items.slice(offset, offset + limit);
  return {
    data: slice,
    pagination: {
      limit,
      ...(offset + limit < items.length ? { next_page_token: encodeOffset(offset + limit) } : {}),
      ...(offset > 0 ? { previous_page_token: encodeOffset(Math.max(0, offset - limit)) } : {}),
    },
  };
}

/**
 * Reference ISessionStore implementation. Proves the contract without SSE/subscription
 * hooks. Deep-copies on read/write boundaries so callers cannot mutate stored state.
 */
export class InMemorySessionStore<
  TSessionCustom extends object = Record<string, never>,
  TTurnCustom extends object = Record<string, never>,
> implements ISessionStore<TSessionCustom, TTurnCustom> {
  private readonly sessions = new Map<string, StoredSession<TSessionCustom>>();
  private readonly turns = new Map<string, TurnRecord<TTurnCustom>>();
  private readonly events = new Map<string, StoredEvent[]>();
  /** Per-session promise chain for atomic createTurn / updateTurnState. */
  private readonly locks = new Map<string, Promise<void>>();

  private async withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    this.locks.set(
      key,
      prev.then(() => gate),
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async createSession(input: {
    tenant_name: string;
    session_id: string;
    agent_spec: AgentSpec;
    custom?: TSessionCustom | undefined;
  }): Promise<void> {
    const key = sessionKey(input.tenant_name, input.session_id);
    if (this.sessions.has(key)) {
      throw new SessionStoreConflictError(`Session already exists: ${input.session_id}`);
    }
    const now = new Date().toISOString();
    const record: SessionRecord<TSessionCustom> = {
      session_id: input.session_id,
      agent_spec: deepCopy(input.agent_spec),
      title: null,
      created_at: now,
      updated_at: now,
      last_activity_timestamp_ms: Date.now(),
      ...(input.custom !== undefined ? { custom: deepCopy(input.custom) } : {}),
    };
    this.sessions.set(key, { record, turnIds: [] });
  }

  async getSession(input: {
    tenant_name: string;
    session_id: string;
  }): Promise<SessionRecord<TSessionCustom> | undefined> {
    const stored = this.sessions.get(sessionKey(input.tenant_name, input.session_id));
    return stored ? deepCopy(stored.record) : undefined;
  }

  async updateSession(input: {
    tenant_name: string;
    session_id: string;
    agent_spec?: AgentSpec | undefined;
    title?: string | undefined;
  }): Promise<void> {
    const key = sessionKey(input.tenant_name, input.session_id);
    const stored = this.sessions.get(key);
    if (!stored) {
      throw new SessionStoreNotFoundError(`Session not found: ${input.session_id}`);
    }
    if (input.agent_spec !== undefined) {
      stored.record.agent_spec = deepCopy(input.agent_spec);
    }
    if (input.title !== undefined) {
      stored.record.title = input.title;
    }
    stored.record.updated_at = new Date().toISOString();
    stored.record.last_activity_timestamp_ms = Date.now();
  }

  async listSessions(input: {
    tenant_name: string;
    limit: number;
    page_token?: string | undefined;
    order?: 'asc' | 'desc' | undefined;
    start_timestamp?: string | undefined;
    end_timestamp?: string | undefined;
  }): Promise<{ data: SessionRecord<TSessionCustom>[]; pagination: TokenPagination }> {
    const prefix = `${input.tenant_name}:`;
    const records: SessionRecord<TSessionCustom>[] = [];
    for (const [key, stored] of this.sessions) {
      if (!key.startsWith(prefix)) continue;
      const createdAt = stored.record.created_at;
      if (input.start_timestamp !== undefined && createdAt < input.start_timestamp) continue;
      if (input.end_timestamp !== undefined && createdAt > input.end_timestamp) continue;
      records.push(stored.record);
    }
    records.sort((a, b) =>
      input.order === 'asc' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at),
    );
    const page = paginate(records, input.limit, input.page_token);
    return { data: deepCopy(page.data), pagination: page.pagination };
  }

  async createTurn(input: {
    tenant_name: string;
    turn: TurnRecord<TTurnCustom>;
    update_session_title_if_not_exist?: string | undefined;
  }): Promise<void> {
    const sKey = sessionKey(input.tenant_name, input.turn.session_id);
    return this.withLock(sKey, () => {
      const stored = this.sessions.get(sKey);
      if (!stored) {
        throw new SessionStoreNotFoundError(`Session not found: ${input.turn.session_id}`);
      }
      const previousTurnId = input.turn.previous_turn_id;
      if (previousTurnId !== undefined) {
        const prevKey = turnKey(input.tenant_name, input.turn.session_id, previousTurnId);
        if (!this.turns.has(prevKey)) {
          throw new SessionStoreNotFoundError(`previous_turn_id not found in session: ${previousTurnId}`);
        }
      }
      const tKey = turnKey(input.tenant_name, input.turn.session_id, input.turn.turn_id);
      if (this.turns.has(tKey)) {
        throw new SessionStoreConflictError(`Turn already exists: ${input.turn.turn_id}`);
      }
      this.turns.set(tKey, deepCopy(input.turn));
      this.events.set(tKey, []);
      stored.turnIds.push(input.turn.turn_id);
      stored.record.last_turn_id = input.turn.turn_id;
      stored.record.last_activity_timestamp_ms = Date.now();
      stored.record.updated_at = new Date().toISOString();
      if (
        input.update_session_title_if_not_exist !== undefined &&
        (stored.record.title === undefined || stored.record.title === null)
      ) {
        stored.record.title = input.update_session_title_if_not_exist;
      }
    });
  }

  async getTurn(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
  }): Promise<TurnRecord<TTurnCustom> | undefined> {
    const turn = this.turns.get(turnKey(input.tenant_name, input.session_id, input.turn_id));
    return turn ? deepCopy(turn) : undefined;
  }

  async listTurns(input: {
    tenant_name: string;
    session_id: string;
    limit: number;
    page_token?: string | undefined;
  }): Promise<{ data: TurnRecord<TTurnCustom>[]; pagination: TokenPagination }> {
    const stored = this.sessions.get(sessionKey(input.tenant_name, input.session_id));
    if (!stored) {
      throw new SessionStoreNotFoundError(`Session not found: ${input.session_id}`);
    }
    const records = stored.turnIds.map(id => {
      const turn = this.turns.get(turnKey(input.tenant_name, input.session_id, id));
      if (!turn) {
        throw new SessionStoreNotFoundError(`Turn not found: ${id}`);
      }
      return deepCopy(turn);
    });
    return paginate(records, input.limit, input.page_token);
  }

  async updateTurnState(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    state: TerminalTurnState;
  }): Promise<void> {
    const sKey = sessionKey(input.tenant_name, input.session_id);
    const tKey = turnKey(input.tenant_name, input.session_id, input.turn_id);
    return this.withLock(sKey, () => {
      const turn = this.turns.get(tKey);
      if (!turn) {
        throw new SessionStoreNotFoundError(`Turn not found: ${input.turn_id}`);
      }
      if (turn.state.status !== 'running') {
        throw new SessionStoreConflictError(
          `Turn ${input.turn_id} is already terminal (${turn.state.status}); first terminal write wins`,
        );
      }
      turn.state = deepCopy(input.state);
      turn.updated_at = new Date().toISOString();
    });
  }

  async appendToEvents(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    events: Array<TurnEvent | TurnCreatedEvent | TurnDoneEvent | RegisteredPassthroughEvent>;
  }): Promise<void> {
    const tKey = turnKey(input.tenant_name, input.session_id, input.turn_id);
    const list = this.events.get(tKey);
    if (!list) {
      throw new SessionStoreNotFoundError(`Turn not found: ${input.turn_id}`);
    }
    list.push(...deepCopy(input.events));
  }

  private requireTurn(tenant: string, sessionId: string, turnId: string): TurnRecord<TTurnCustom> {
    const turn = this.turns.get(turnKey(tenant, sessionId, turnId));
    if (!turn) {
      throw new SessionStoreNotFoundError(`Turn not found: ${turnId}`);
    }
    return turn;
  }

  async addThreads(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    threads: AgentThreadSnapshot[];
  }): Promise<void> {
    const turn = this.requireTurn(input.tenant_name, input.session_id, input.turn_id);
    for (const thread of input.threads) {
      turn.snapshot.threads[thread.thread_id] = deepCopy(thread);
    }
    turn.updated_at = new Date().toISOString();
  }

  async removeThreads(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    thread_ids: string[];
  }): Promise<void> {
    const turn = this.requireTurn(input.tenant_name, input.session_id, input.turn_id);
    for (const id of input.thread_ids) {
      delete turn.snapshot.threads[id];
    }
    turn.updated_at = new Date().toISOString();
  }

  async appendToThreadContext(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    thread_id: string;
    context: ContextMessage[];
    current_context_usage?: CompletionUsage | undefined;
    completion?: SubAgentCompletionMarker | undefined;
  }): Promise<void> {
    const turn = this.requireTurn(input.tenant_name, input.session_id, input.turn_id);
    const thread = turn.snapshot.threads[input.thread_id];
    if (!thread) {
      throw new SessionStoreNotFoundError(`Thread not found: ${input.thread_id}`);
    }
    thread.context.push(...deepCopy(input.context));
    if (input.current_context_usage !== undefined) {
      thread.current_context_usage = deepCopy(input.current_context_usage);
    }
    if (input.completion !== undefined) {
      thread.completion = deepCopy(input.completion);
    }
    turn.updated_at = new Date().toISOString();
  }

  async overwriteThreadContext(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    event: ThreadOverwriteContextEvent;
  }): Promise<void> {
    const turn = this.requireTurn(input.tenant_name, input.session_id, input.turn_id);
    const threadId = input.event.thread_id;
    const thread = turn.snapshot.threads[threadId];
    if (!thread) {
      throw new SessionStoreNotFoundError(`Thread not found: ${threadId}`);
    }
    thread.context = deepCopy(input.event.context);
    if (input.event.current_context_usage !== undefined) {
      thread.current_context_usage = deepCopy(input.event.current_context_usage);
    }
    turn.updated_at = new Date().toISOString();
  }

  async patchMCPServers(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    mcp_servers: MCPServerInitInfo[];
  }): Promise<void> {
    const turn = this.requireTurn(input.tenant_name, input.session_id, input.turn_id);
    if (!turn.snapshot.mcp_servers) {
      turn.snapshot.mcp_servers = {};
    }
    for (const server of input.mcp_servers) {
      turn.snapshot.mcp_servers[server.id] = deepCopy(server);
    }
    turn.updated_at = new Date().toISOString();
  }

  async patchSandboxInfo(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    sandbox_info: SandboxInfo;
  }): Promise<void> {
    const turn = this.requireTurn(input.tenant_name, input.session_id, input.turn_id);
    turn.snapshot.sandbox_info = deepCopy(input.sandbox_info);
    turn.updated_at = new Date().toISOString();
  }

  async patchThreadCapabilityState(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    thread_id: string;
    key: string;
    state: unknown;
  }): Promise<void> {
    const turn = this.requireTurn(input.tenant_name, input.session_id, input.turn_id);
    const thread = turn.snapshot.threads[input.thread_id];
    if (!thread) {
      throw new SessionStoreNotFoundError(`Thread not found: ${input.thread_id}`);
    }
    if (!thread.capability_state) {
      thread.capability_state = {};
    }
    thread.capability_state[input.key] = deepCopy(input.state);
    turn.updated_at = new Date().toISOString();
  }

  async listTurnEvents(input: {
    tenant_name: string;
    session_id: string;
    turn_id: string;
    limit: number;
    page_token?: string | undefined;
    order?: 'asc' | 'desc' | undefined;
  }): Promise<{
    data: Array<TurnEvent | TurnCreatedEvent | TurnDoneEvent | RegisteredPassthroughEvent>;
    pagination: TokenPagination;
  }> {
    const list = this.events.get(turnKey(input.tenant_name, input.session_id, input.turn_id));
    if (!list) {
      throw new SessionStoreNotFoundError(`Turn not found: ${input.turn_id}`);
    }
    const ordered = input.order === 'desc' ? [...list].reverse() : list;
    const page = paginate(ordered, input.limit, input.page_token);
    return { data: deepCopy(page.data), pagination: page.pagination };
  }

  async listSessionEvents(input: {
    tenant_name: string;
    session_id: string;
    limit: number;
    page_token?: string | undefined;
    last_turn_id?: string | undefined;
  }): Promise<{
    data: Array<{ turn_id: string; event: TurnCreatedEvent | TurnDoneEvent | TurnEvent }>;
    pagination: TokenPagination;
  }> {
    const stored = this.sessions.get(sessionKey(input.tenant_name, input.session_id));
    if (!stored) {
      throw new SessionStoreNotFoundError(`Session not found: ${input.session_id}`);
    }
    let turnIds = stored.turnIds;
    if (input.last_turn_id) {
      const anchor = this.turns.get(turnKey(input.tenant_name, input.session_id, input.last_turn_id));
      if (!anchor) {
        throw new SessionStoreNotFoundError(`Turn not found: ${input.last_turn_id}`);
      }
      turnIds = [...anchor.ancestor_ids, anchor.turn_id];
    }
    const flattened: Array<{ turn_id: string; event: TurnCreatedEvent | TurnDoneEvent | TurnEvent }> = [];
    for (const turnId of turnIds) {
      const evts = this.events.get(turnKey(input.tenant_name, input.session_id, turnId)) ?? [];
      for (const event of evts) {
        if (isSessionFeedEvent(event)) {
          flattened.push({ turn_id: turnId, event });
        }
      }
    }
    // Newest first for session feed.
    flattened.reverse();
    const page = paginate(flattened, input.limit, input.page_token);
    return { data: deepCopy(page.data), pagination: page.pagination };
  }
}

function isSessionFeedEvent(event: StoredEvent): event is TurnCreatedEvent | TurnDoneEvent | TurnEvent {
  return event.type === 'turn.created' || event.type === 'turn.done' || !('event' in event);
}
