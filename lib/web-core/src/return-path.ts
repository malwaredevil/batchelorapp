/**
 * Accept only same-origin absolute paths. Browsers normalize backslashes and
 * strip control characters before resolving URLs, so checking "//" alone is
 * insufficient. Keep the original path/query/fragment intact when it is safe.
 */
export function sanitizeReturnPath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f,
    )
  ) {
    return null;
  }
  return value;
}
