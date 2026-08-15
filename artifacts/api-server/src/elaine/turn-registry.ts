import { randomUUID } from "node:crypto";

/**
 * In-memory registry of live (and recently finished) Elaine web-chat turns.
 *
 * Purpose: make maximizing the floating widget seamless. Each streaming turn
 * gets a stable turn id and buffers every SSE event it emits, so a second
 * client (the full Elaine app, after a maximize navigation) can attach
 * mid-turn, instantly replay everything generated so far, and keep receiving
 * live events until the turn completes — while the original connection may
 * have been intentionally dropped ("handoff") without aborting generation.
 *
 * This is deliberately process-local: a handoff happens within one browser
 * over a couple of seconds, and dev/prod both run a single api-server
 * process. If the process restarts mid-turn the turn is lost anyway, and the
 * client falls back gracefully to plain persisted history.
 */

export interface ElaineTurnEvent {
  event: string;
  data: unknown;
}

type TurnListener = (event: ElaineTurnEvent) => void;

export interface ElaineLiveTurn {
  turnId: string;
  userId: number;
  conversationId: number | null;
  /** Every SSE event emitted so far, in order, for replay on attach. */
  events: ElaineTurnEvent[];
  /** Live attach subscribers (resume endpoint connections). */
  listeners: Set<TurnListener>;
  /** True once the client signalled "my disconnect is a handoff, keep going". */
  handoff: boolean;
  /** True once the turn finished (done or error event emitted + finalized). */
  done: boolean;
  createdAt: number;
  completedAt: number | null;
}

// How long a finished turn stays attachable (covers the maximize navigation
// plus a slow full-app load). After this, attach returns 404 and the client
// falls back to persisted history, which by then contains the final message.
const DONE_RETENTION_MS = 2 * 60 * 1000;
// Absolute cap for a live turn's registry entry — a turn should never run
// this long; this only guards against leaked entries.
const LIVE_RETENTION_MS = 20 * 60 * 1000;
// Cap on buffered events per turn (deltas are small; this is far above any
// real turn). Beyond it we stop buffering but keep fanning out live events.
const MAX_BUFFERED_EVENTS = 10_000;

const turns = new Map<string, ElaineLiveTurn>();

function sweep(now = Date.now()) {
  for (const [id, turn] of turns) {
    const age = now - (turn.completedAt ?? turn.createdAt);
    if (turn.done ? age > DONE_RETENTION_MS : age > LIVE_RETENTION_MS) {
      turns.delete(id);
    }
  }
}

export function registerElaineTurn(params: {
  userId: number;
  conversationId: number | null;
}): ElaineLiveTurn {
  sweep();
  const turn: ElaineLiveTurn = {
    turnId: randomUUID(),
    userId: params.userId,
    conversationId: params.conversationId,
    events: [],
    listeners: new Set(),
    handoff: false,
    done: false,
    createdAt: Date.now(),
    completedAt: null,
  };
  turns.set(turn.turnId, turn);
  return turn;
}

/** Buffer an event for replay and fan it out to all attached listeners. */
export function publishElaineTurnEvent(
  turn: ElaineLiveTurn,
  event: string,
  data: unknown,
) {
  const entry: ElaineTurnEvent = { event, data };
  if (turn.events.length < MAX_BUFFERED_EVENTS) {
    turn.events.push(entry);
  }
  for (const listener of turn.listeners) {
    try {
      listener(entry);
    } catch {
      // A broken subscriber must never take down the generating turn.
      turn.listeners.delete(listener);
    }
  }
}

/** Mark the turn finished. Attached listeners are notified via the terminal
 *  `done`/`error` event published just before this; here we only flip state
 *  so future attaches replay-and-end instead of waiting. */
export function completeElaineTurn(turn: ElaineLiveTurn) {
  turn.done = true;
  turn.completedAt = Date.now();
  turn.listeners.clear();
}

/** Look up a turn, enforcing ownership. */
export function getElaineTurn(
  turnId: string,
  userId: number,
): ElaineLiveTurn | null {
  const turn = turns.get(turnId);
  if (!turn || turn.userId !== userId) return null;
  return turn;
}

/** Flag the turn so the generating request keeps going (and persists a
 *  normal, non-stopped message) even when its own connection closes.
 *  Returns false when the turn is unknown/not owned (already evicted, etc.). */
export function markElaineTurnHandoff(turnId: string, userId: number): boolean {
  const turn = getElaineTurn(turnId, userId);
  if (!turn) return false;
  turn.handoff = true;
  return true;
}

export function attachElaineTurnListener(
  turn: ElaineLiveTurn,
  listener: TurnListener,
) {
  turn.listeners.add(listener);
}

export function detachElaineTurnListener(
  turn: ElaineLiveTurn,
  listener: TurnListener,
) {
  turn.listeners.delete(listener);
}

/** Test-only: reset the registry between tests. */
export function __resetElaineTurnRegistryForTests() {
  turns.clear();
}

/** Test-only: list currently registered turns (lets a live-handoff test
 *  discover the turn id server-side, mimicking a maximize that happens before
 *  the browser has received the `turn` SSE event). */
export function __listElaineTurnsForTests(): ElaineLiveTurn[] {
  return Array.from(turns.values());
}
