/**
 * Shared helper for the OpenRouter subagent-degraded retry pattern.
 *
 * When an OpenRouter round fails with a 5xx and the `openrouter:subagent`
 * server tool was active, stripping the tool and retrying is the one lever
 * available to us (we can't tell from the status code alone whether the error
 * came from the primary chat model or the subagent model, but changing the
 * request is worth one attempt before handing the error up to the outer
 * turn-budget recovery loop).
 *
 * Callers own all mutable streaming state (rawContent, toolCallAcc, SSE
 * events) and pass reset/fallback callbacks so this function stays pure and
 * testable without the full streaming closure.
 */

export interface SubagentFallbackOptions {
  /** Run the primary round (may throw). */
  primary: () => Promise<void>;
  /**
   * Returns true when a caught error should trigger the degraded retry.
   * Typically: `is5xxError(err) && features.enableSubagent && !aborted`.
   */
  shouldDegrade: (err: unknown) => boolean;
  /**
   * Called synchronously before the fallback attempt — clear rawContent,
   * toolCallAcc, and emit a `response_reset` SSE event so the client sees a
   * clean replacement response, not appended fragments.
   */
  onReset: () => void;
  /** Run the degraded round without the subagent tool (may throw). */
  fallback: () => Promise<void>;
  /** Optional side-effect called when degradation is triggered (e.g. log). */
  onDegraded?: (err: unknown) => void;
}

/**
 * Run `primary`. On a qualifying error, synchronously call `onReset`, then
 * run `fallback`. Any other error (or a fallback error) propagates normally.
 */
export async function runWithSubagentFallback(
  opts: SubagentFallbackOptions,
): Promise<void> {
  try {
    await opts.primary();
  } catch (err) {
    if (opts.shouldDegrade(err)) {
      opts.onDegraded?.(err);
      opts.onReset();
      await opts.fallback();
    } else {
      throw err;
    }
  }
}
