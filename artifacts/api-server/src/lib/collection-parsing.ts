export function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === "string");
  }
  if (typeof raw !== "string") return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (value): value is string => typeof value === "string",
      );
    }
  } catch {
    // Multipart clients may send a comma-delimited field instead of JSON.
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseIntegerArray(raw: unknown): number[] {
  const values = (() => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== "string") return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to the comma-delimited multipart representation.
    }
    return raw.split(",");
  })();

  return values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
}

export function parsePositiveIntegerArray(raw: unknown): number[] {
  return parseIntegerArray(raw).filter((value) => value > 0);
}

export function normalizeCollectionText(value: string): string {
  return value.replace(/[″\u201C\u201D]/g, '"').toLowerCase();
}

export interface NamedCategory {
  id: number;
  name: string;
}

/** Match category names as complete phrases, not substrings of larger words. */
export function matchCategoryIds(
  categories: NamedCategory[],
  values: unknown[],
): number[] {
  const searchable = normalizeCollectionText(
    values
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      )
      .join(" "),
  );

  return categories
    .filter((category) => {
      const normalized = normalizeCollectionText(category.name);
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(
        searchable,
      );
    })
    .map((category) => category.id);
}

export function mergeExistingCategoryIds(
  categories: NamedCategory[],
  ...candidateLists: number[][]
): number[] {
  const existing = new Set(categories.map((category) => category.id));
  return [
    ...new Set(
      candidateLists.flat().filter((categoryId) => existing.has(categoryId)),
    ),
  ];
}
