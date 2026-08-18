// Helpers for making sense of model tool-call argument buffers.
//
// Background (#1110): when an OpenAI Responses round fails mid-turn and the
// turn falls back to OpenRouter, some OpenRouter providers have been observed
// delivering tool-call arguments as duplicated/concatenated JSON objects
// (`{"a":1}{"a":1}`) or with trailing junk, which makes a plain
// `JSON.parse(argsBuffer)` throw even though a perfectly valid payload is
// present at the start of the buffer. Rather than dropping the user's action
// on the floor, we salvage the first balanced top-level JSON value.

/**
 * Returns the first balanced top-level JSON object or array in `buffer`
 * (as a raw substring, not parsed), or null when no complete balanced value
 * starts at the first `{`/`[`. String literals and escapes are respected so
 * braces inside strings don't confuse the scan.
 */
export function extractFirstBalancedJsonValue(buffer: string): string | null {
  const start = buffer.search(/[{[]/);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < buffer.length; i++) {
    const ch = buffer[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return buffer.slice(start, i + 1);
    }
  }
  return null;
}

export type ParsedToolCallArgs =
  | { ok: true; value: unknown; salvaged: boolean }
  | { ok: false; error: string };

/**
 * Parse a tool-call argument buffer, salvaging the first balanced JSON value
 * when the whole buffer isn't valid JSON (duplicated/concatenated args or
 * trailing junk from a provider). `salvaged: true` signals the caller should
 * log that the raw buffer was malformed.
 */
export function parseToolCallArgs(argsBuffer: string): ParsedToolCallArgs {
  try {
    return { ok: true, value: JSON.parse(argsBuffer), salvaged: false };
  } catch (err) {
    const salvagedRaw = extractFirstBalancedJsonValue(argsBuffer);
    if (salvagedRaw !== null && salvagedRaw !== argsBuffer) {
      try {
        return { ok: true, value: JSON.parse(salvagedRaw), salvaged: true };
      } catch {
        // fall through to the original error
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
