/**
 * In-memory circuit breaker (#231 — provider resilience).
 *
 * State machine:
 *  CLOSED      → normal operation; failure count tracked in a rolling window.
 *  OPEN        → fast-failing; after resetTimeoutMs → HALF_OPEN.
 *  HALF_OPEN   → single probe allowed; success → CLOSED, failure → OPEN.
 *
 * State is in-memory (resets on server restart), which is acceptable for the
 * MVP: the goal is to prevent cascade failures within a running instance, not
 * to persist state across deploys.
 */

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  windowMs?: number;
  resetTimeoutMs?: number;
  onStateChange?: (key: string, from: CircuitState, to: CircuitState) => void;
}

interface CircuitRecord {
  state: CircuitState;
  failures: number[];
  successes: number;
  openedAt: number | null;
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_SUCCESS_THRESHOLD = 2;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;

export class CircuitBreaker {
  private circuits = new Map<string, CircuitRecord>();
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly windowMs: number;
  private readonly resetTimeoutMs: number;
  private readonly onStateChange: CircuitBreakerOptions["onStateChange"];

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold =
      options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.successThreshold =
      options.successThreshold ?? DEFAULT_SUCCESS_THRESHOLD;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.resetTimeoutMs = options.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
    this.onStateChange = options.onStateChange;
  }

  private getCircuit(key: string): CircuitRecord {
    let circuit = this.circuits.get(key);
    if (!circuit) {
      circuit = { state: "closed", failures: [], successes: 0, openedAt: null };
      this.circuits.set(key, circuit);
    }
    return circuit;
  }

  private transition(
    key: string,
    circuit: CircuitRecord,
    to: CircuitState,
  ): void {
    const from = circuit.state;
    if (from === to) return;
    circuit.state = to;
    if (to === "open") {
      circuit.openedAt = Date.now();
      circuit.successes = 0;
    } else if (to === "closed") {
      circuit.failures = [];
      circuit.successes = 0;
      circuit.openedAt = null;
    } else if (to === "half_open") {
      circuit.successes = 0;
    }
    this.onStateChange?.(key, from, to);
  }

  getState(key: string): CircuitState {
    const circuit = this.getCircuit(key);
    if (circuit.state === "open" && circuit.openedAt !== null) {
      if (Date.now() - circuit.openedAt >= this.resetTimeoutMs) {
        this.transition(key, circuit, "half_open");
      }
    }
    return circuit.state;
  }

  isOpen(key: string): boolean {
    return this.getState(key) === "open";
  }

  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>,
  ): Promise<T> {
    const state = this.getState(key);

    if (state === "open") {
      if (fallback) return fallback();
      throw new CircuitOpenError(key);
    }

    try {
      const result = await fn();
      this.recordSuccess(key);
      return result;
    } catch (err) {
      this.recordFailure(key);
      if (fallback) return fallback();
      throw err;
    }
  }

  recordSuccess(key: string): void {
    const circuit = this.getCircuit(key);
    if (circuit.state === "half_open") {
      circuit.successes += 1;
      if (circuit.successes >= this.successThreshold) {
        this.transition(key, circuit, "closed");
      }
    }
  }

  recordFailure(key: string): void {
    const circuit = this.getCircuit(key);
    const now = Date.now();
    const windowStart = now - this.windowMs;

    circuit.failures = circuit.failures.filter((t) => t > windowStart);
    circuit.failures.push(now);

    if (
      circuit.state === "half_open" ||
      circuit.failures.length >= this.failureThreshold
    ) {
      this.transition(key, circuit, "open");
    }
  }

  reset(key: string): void {
    const circuit = this.getCircuit(key);
    this.transition(key, circuit, "closed");
  }

  getStats(key: string): {
    state: CircuitState;
    recentFailures: number;
    openedAt: number | null;
  } {
    const circuit = this.getCircuit(key);
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const recentFailures = circuit.failures.filter(
      (t) => t > windowStart,
    ).length;
    return {
      state: circuit.state,
      recentFailures,
      openedAt: circuit.openedAt,
    };
  }

  getAllStats(): Record<
    string,
    { state: CircuitState; recentFailures: number; openedAt: number | null }
  > {
    const result: Record<
      string,
      { state: CircuitState; recentFailures: number; openedAt: number | null }
    > = {};
    for (const key of this.circuits.keys()) {
      result[key] = this.getStats(key);
    }
    return result;
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly circuitKey: string) {
    super(`Circuit breaker is open for: ${circuitKey}`);
    this.name = "CircuitOpenError";
  }
}

/**
 * Shared singleton used by the AI client and external fetches.
 * Per-provider keys: "openrouter", "jina", "voyage", "apify", "upcitemdb", etc.
 */
export const circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  windowMs: 60_000,
  resetTimeoutMs: 30_000,
});
