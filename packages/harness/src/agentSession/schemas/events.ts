/**
 * Turn/session event product schemas. Event payloads come from the harness; this
 * module owns turn lifecycle events (turn.created / turn.done) and the persisted
 * event unions the store writes. SSE streaming envelopes stay in server/schemas.
 */
import { z } from '@hono/zod-openapi';
import {
  EventIdSchema,
  EventType as HarnessEventType,
  MCPAuthRequiredEventSchema,
  MCPInitializeEventSchema,
  ModelMessageEventSchema,
  SandboxCreatedEventSchema,
  ThreadCreatedEventSchema,
  ThreadDoneEventSchema,
  ToolApprovalRequiredEventSchema,
  ToolResponseEventSchema,
  ToolResponseRequiredEventSchema,
} from '../../core/events/eventSchemas';
import {
  TurnInputItemSchema,
  TurnStateCancelledSchema,
  TurnStateDoneSchema,
  TurnStateErrorSchema,
  TurnStateRunningSchema,
} from './turn';

/** Harness event types plus the turn lifecycle types owned by agentSession. */
export const EventType = {
  ...HarnessEventType,
  TURN_CREATED: 'turn.created',
  TURN_DONE: 'turn.done',
} as const;

export const TurnCreatedEventSchema = z
  .object({
    type: z.literal(EventType.TURN_CREATED),
    id: EventIdSchema,
    turn_id: z.string(),
    previous_turn_id: z.string().nullable(),
    input: z.array(TurnInputItemSchema).optional(),
    state: TurnStateRunningSchema,
    created_at: z.string(),
    thread_id: z.string().nullable(),
  })
  .openapi('TurnCreatedEvent');

export const TurnDoneEventSchema = z
  .object({
    type: z.literal(EventType.TURN_DONE),
    id: EventIdSchema,
    state: z.discriminatedUnion('status', [TurnStateDoneSchema, TurnStateCancelledSchema, TurnStateErrorSchema]),
    created_at: z.string(),
    thread_id: z.string().nullable(),
  })
  .openapi('TurnDoneEvent');

/** Persisted turn content events — no deltas, no lifecycle. */
export const TurnEventSchema = z
  .discriminatedUnion('type', [
    ModelMessageEventSchema,
    ToolResponseEventSchema,
    ThreadCreatedEventSchema,
    ThreadDoneEventSchema,
    MCPAuthRequiredEventSchema,
    MCPInitializeEventSchema,
    SandboxCreatedEventSchema,
    ToolApprovalRequiredEventSchema,
    ToolResponseRequiredEventSchema,
  ])
  .openapi('TurnEvent');

/** turn.created, turn.done, or a persisted turn event — no deltas. */
const SessionEventSchema = z
  .discriminatedUnion('type', [TurnCreatedEventSchema, TurnDoneEventSchema, ...TurnEventSchema.options])
  .openapi('SessionEvent');

/** One row on the session timeline: which turn emitted the event plus the event payload. */
export const SessionEventItemSchema = z
  .object({
    turn_id: z.string(),
    event: SessionEventSchema,
  })
  .openapi('SessionEventItem');

export type TurnCreatedEvent = z.infer<typeof TurnCreatedEventSchema>;
export type TurnDoneEvent = z.infer<typeof TurnDoneEventSchema>;
export type TurnEvent = z.infer<typeof TurnEventSchema>;
export type SessionEventItem = z.infer<typeof SessionEventItemSchema>;
