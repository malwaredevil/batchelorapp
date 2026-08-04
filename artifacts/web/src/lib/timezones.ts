// Shared list of common IANA timezones used to power timezone <select>
// dropdowns (account settings, owner panel). This is a convenience subset
// for the UI, not an enum — any IANA name accepted by the runtime `Intl` API
// is a valid value server-side (see artifacts/api-server/src/lib/timezone.ts).
export const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];
