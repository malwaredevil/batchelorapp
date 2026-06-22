/**
 * Shared defensive parsers for AI/vision JSON responses. Both the pottery and
 * quilting cataloguers ask the model for STRICT JSON, but the output is still
 * untrusted — these helpers coerce arbitrary values into the narrow shapes the
 * route handlers expect, never throwing on malformed model output.
 */

export type Verdict = "yes" | "maybe" | "no";

export function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, 8);
}

export function asVerdict(value: unknown): Verdict {
  return value === "yes" || value === "maybe" || value === "no" ? value : "no";
}

export function parseJson(content: string | null): Record<string, unknown> {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
