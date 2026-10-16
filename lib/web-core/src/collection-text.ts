/** Canonical category/tag spelling shared by collection forms and the API. */
export function normalizeCollectionTag(raw: string): string {
  const value = raw
    .replace(
      /[\u201C\u201D\u201E\u201F\u2033\u2036\u275D\u275E\u301D\u301E\u02BA\uFF02]/g,
      '"',
    )
    .replace(
      /[\u2018\u2019\u201A\u201B\u2032\u2035\u275B\u275C\u02B9\u02BC\uFF07]/g,
      "'",
    )
    .replace(/[\u2013\u2014\u2015\u2012]/g, "-")
    .replace(/\u2026/g, "...")
    .trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}
