/**
 * Returns true when `tz` is a timezone name that `Intl.DateTimeFormat`
 * accepts (i.e. a valid IANA timezone identifier, e.g. "America/Denver").
 *
 * Shared between the self-service profile timezone validator (auth.ts) and
 * the comm-check scheduler's effective-timezone resolution, so both agree on
 * exactly what counts as valid without hardcoding an IANA name list.
 */
export function isValidIanaTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
