/** Deterministic labels from saved measurements; no AI calls or size estimates. */
type Measurement = { value: number; unit: "in" | "cm" };
export type PotterySize = { name: string; key: string };

const fractions: Record<string, string> = {
  "¼": " 1/4",
  "½": " 1/2",
  "¾": " 3/4",
  "⅛": " 1/8",
  "⅜": " 3/8",
  "⅝": " 5/8",
  "⅞": " 7/8",
};
const number = String.raw`(?:(?:\d+\s+)?\d+\/\d+|\d+(?:[.,]\d+)?)`;
const token = new RegExp(
  String.raw`(?<![\d./-])(${number})\s*(cm\b|centimet(?:er|re)s?\b|″|"|inches\b|inch\b|in\b)`,
  "gi",
);

function numeric(value: string): number {
  if (!value.includes("/")) return Number(value.replace(",", "."));
  const parts = value.trim().split(/\s+/);
  const [numerator, denominator] = parts.pop()!.split("/").map(Number);
  return Number(parts[0] ?? 0) + numerator / denominator;
}

function measurements(text: string): Measurement[] {
  return [...text.matchAll(token)].map((m) => ({
    value: numeric(m[1]),
    unit: /^(cm|centim)/i.test(m[2]) ? "cm" : "in",
  }));
}

function outsideParentheses(text: string): string[] {
  let depth = 0;
  let start = 0;
  const axes: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (
      depth === 0 &&
      /[×x]/.test(text[i]) &&
      /\d/.test(text.slice(i + 1))
    ) {
      // "approx" contains an x too; separators must have whitespace or digits.
      if (!/[\s\d")]/.test(text[i - 1] ?? "")) continue;
      axes.push(text.slice(start, i));
      start = i + 1;
    }
  }
  axes.push(text.slice(start));
  return axes;
}

/**
 * Parses both unit orders, ordinary/curly quotes and fractional inches.
 * Composite representation is retained for recognizing legacy categories only.
 * Category creation must use potterySizeLabels, never this combined name.
 */
export function potterySizeLabel(
  raw: string | null | undefined,
): PotterySize | null {
  if (!raw || raw.length > 1000) return null;
  const text = raw
    .replace(/\\(?=["″“”])/g, "")
    .replace(/[¼½¾⅛⅜⅝⅞]/g, (v) => fractions[v])
    .replace(/[“”]/g, '"');
  if (
    /unknown|unmeasur|not measur|cannot|unable|unavailable|n\/a|\d\s*[-–—]\s*\d|\b(?:to|or)\b/i.test(
      text,
    )
  )
    return null;
  const all = measurements(text);
  if (
    !all.length ||
    all.some(
      (m) => !Number.isFinite(m.value) || m.value <= 0 || m.value > 10000,
    )
  )
    return null;
  // Do not silently drop a second, unit-less dimension or an ambiguous range.
  if (/\d/.test(text.replace(token, ""))) return null;
  const inches = all.filter((m) => m.unit === "in");
  const cm = all.filter((m) => m.unit === "cm");
  const groups = outsideParentheses(text).map(measurements);
  const explicitAxes =
    groups.length > 1 &&
    groups.every(
      (g) =>
        g.length &&
        g.filter((m) => m.unit === "in").length <= 1 &&
        g.filter((m) => m.unit === "cm").length <= 1,
    );
  let axes: Measurement[];
  if (explicitAxes)
    axes = groups.map((g) => g.find((m) => m.unit === "in") ?? g[0]);
  else if (!inches.length) axes = cm;
  else if (!cm.length || inches.length === cm.length) axes = inches;
  else {
    // e.g. "9 cm (3½″ mug) diameter × 9 cm height".
    if (
      groups.some(
        (g) =>
          !g.length ||
          g.filter((m) => m.unit === "in").length > 1 ||
          g.filter((m) => m.unit === "cm").length > 1,
      )
    )
      return null;
    axes = groups.map((g) => g.find((m) => m.unit === "in") ?? g[0]);
  }
  if (axes.length > 3) return null;
  const format = (v: number) => String(Number(v.toFixed(4)));
  return {
    name: axes
      .map((m) =>
        m.unit === "in"
          ? `${format(m.value)}″ (${Math.round(m.value * 2.54)} cm)`
          : `${format(m.value)} cm`,
      )
      .join(" × "),
    // Retain exact imperial distinctions: 7¾″ and 8″ both round to 20 cm.
    key: axes.map((m) => `${m.unit}:${format(m.value)}`).join("|"),
  };
}

/** One reusable label per axis value; equal axes share the same label. */
export function potterySizeLabels(
  raw: string | null | undefined,
): PotterySize[] {
  const combined = potterySizeLabel(raw);
  if (!combined) return [];
  const names = combined.name.split(" × ");
  return [
    ...new Map(
      combined.key
        .split("|")
        .map((key, i) => [key, { key, name: names[i] }] as const),
    ).values(),
  ];
}

/** Only measurement-only categories, not e.g. a named "8 inch bowls" category. */
export function sizeCategoryKey(name: string): string | null {
  const plain = name
    .replace(/\\(?=["″“”])/g, "")
    .replace(/[¼½¾⅛⅜⅝⅞]/g, (v) => fractions[v])
    .replace(/[“”]/g, '"')
    .replace(token, "")
    .replace(
      /\b(?:approx(?:imately)?|size|diameter|height|width|length|depth|h|w|d|l)\b/gi,
      "",
    )
    .replace(/[\s():×x.]/g, "");
  return plain ? null : (potterySizeLabel(name)?.key ?? null);
}
