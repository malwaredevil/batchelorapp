/** A complete, timezone-qualified display shared by confirmations and lookups. */
export function formatScheduledContactTime(
  iso: string,
  timezone: string,
): string {
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso))} (${timezone})`;
}
