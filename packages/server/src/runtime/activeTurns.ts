/**
 * In-memory registry of running turns, at most one per session. Cancel and
 * turn-creation code abort a run through its AbortController; TurnHandle.stream()
 * writes the terminal state when the signal fires.
 */
interface ActiveTurn {
  turnId: string;
  abortController: AbortController;
}

export class ActiveTurnRegistry {
  private readonly runs = new Map<string, ActiveTurn>();

  /** Registers the session's running turn. The previous entry, if any, must already be cancelled. */
  register(input: { sessionId: string; turnId: string; abortController: AbortController }): void {
    this.runs.set(input.sessionId, { turnId: input.turnId, abortController: input.abortController });
  }

  /** Removes the entry once the turn's stream has fully drained. */
  finish(input: { sessionId: string; turnId: string }): void {
    const active = this.runs.get(input.sessionId);
    if (active?.turnId === input.turnId) {
      this.runs.delete(input.sessionId);
    }
  }

  /**
   * Aborts the session's running turn if there is one. Returns true when a
   * run was found (already-aborted runs are not re-aborted). Cancelling a
   * session with no running turn is a no-op, mirroring the store's
   * first-terminal-write-wins rule.
   */
  cancelIfRunning(input: { sessionId: string; abortReason?: string }): boolean {
    const active = this.runs.get(input.sessionId);
    if (!active) {
      return false;
    }
    if (!active.abortController.signal.aborted) {
      active.abortController.abort(input.abortReason);
    }
    return true;
  }
}
