/**
 * Canonical pottery color palette.
 * The AI prompt instructs the model to pick only from these names,
 * so swatches always render with the correct hex and filtering is consistent.
 */
export const POTTERY_COLORS: Record<string, string> = {
  white: "#F5F5F5",
  cream: "#FFF8E1",
  ivory: "#FFFFF0",
  beige: "#F0E6D0",
  tan: "#D2B48C",
  brown: "#8B5E3C",
  "dark brown": "#5C2E00",
  terracotta: "#C85A2A",
  gold: "#D4A017",
  yellow: "#F5C518",
  orange: "#E07820",
  red: "#B22222",
  burgundy: "#7D0A0A",
  pink: "#F4A0B4",
  lavender: "#B09CC8",
  purple: "#6B3FA0",
  "light blue": "#A8C8E8",
  "sky blue": "#5DA0D0",
  blue: "#2E6DB4",
  "cobalt blue": "#0047AB",
  navy: "#1B2A4A",
  teal: "#00827F",
  turquoise: "#48BEAA",
  green: "#3A7D44",
  sage: "#7A9E7E",
  olive: "#7A7A3A",
  grey: "#9E9E9E",
  black: "#2C2C2C",
};

/**
 * Extended aliases covering the full range of names an AI or user might use
 * for pottery colours before the curated palette was introduced.
 * Resolved in priority order: POTTERY_COLORS exact → ALIASES exact → longest-substring.
 */
const ALIASES: Record<string, string> = {
  // White/cream family
  "off white": "#F8F4E8",
  "warm white": "#F8F4E8",
  "antique white": "#FAEBD7",
  "cream white": "#FFF8E1",
  linen: "#FAF0E6",
  ecru: "#F0E0C0",
  parchment: "#F8F0D8",
  natural: "#E8DCC0",
  bisque: "#FFE4C4",

  // Beige/tan/stone family
  stone: "#C4B8A0",
  sand: "#D4C08C",
  buff: "#D8C4A0",
  mushroom: "#C4A882",
  taupe: "#8B8580",
  fawn: "#C4A06C",

  // Brown family
  chocolate: "#5C3018",
  walnut: "#5C3018",
  mahogany: "#6C2018",
  caramel: "#C4883C",
  toffee: "#C4783C",
  mocha: "#8B5A2B",
  chestnut: "#8B4513",
  sepia: "#7B3F00",
  sienna: "#A0522D",
  umber: "#8B5E3C",

  // Terracotta/rust/copper
  rust: "#B44020",
  copper: "#B87333",
  brick: "#AA4433",
  "brick red": "#AA4433",
  "burnt sienna": "#A0522D",
  "burnt orange": "#CC5500",

  // Gold/yellow family
  ochre: "#C8901A",
  ocher: "#C8901A",
  amber: "#D4780A",
  golden: "#D4A017",
  gilt: "#D4A017",
  gilded: "#D4A017",
  saffron: "#F4C430",
  mustard: "#C0901A",
  straw: "#E8D890",
  lemon: "#F8E050",
  primrose: "#F8E878",
  canary: "#F8DB14",
  sunshine: "#F5C518",
  corn: "#F5C518",
  lustre: "#D4A017",

  // Orange family
  apricot: "#FAB87A",
  peach: "#FFCBA4",

  // Red/pink family
  scarlet: "#C22020",
  crimson: "#9C1C1C",
  claret: "#7D0A0A",
  wine: "#7D0A0A",
  raspberry: "#9C2060",
  cherry: "#9C2040",
  rose: "#F09090",
  salmon: "#FA8072",
  coral: "#FF7F50",
  blush: "#FFCCCB",
  "pale pink": "#F8C0C0",

  // Purple/lavender family
  lilac: "#C8A0D8",
  mauve: "#B080A0",
  violet: "#7840B0",
  plum: "#60186C",
  heather: "#9878A0",
  wisteria: "#B09AC8",
  indigo: "#4040A0",

  // Blue family
  cobalt: "#0047AB",
  delft: "#0047AB",
  "delft blue": "#0047AB",
  delftware: "#0047AB",
  wedgwood: "#4E7FA3",
  "wedgwood blue": "#4E7FA3",
  jasper: "#4E7FA3",
  "powder blue": "#B0C4DE",
  "pale blue": "#B8D4E8",
  "duck egg": "#99C8C8",
  "duck egg blue": "#99C8C8",
  cornflower: "#6A88D4",
  "cornflower blue": "#6A88D4",
  periwinkle: "#8080C0",
  "royal blue": "#2040A0",
  "midnight blue": "#1B2A4A",
  "steel blue": "#4682B4",
  "transferware blue": "#2E6DB4",
  "willow blue": "#6090A8",
  "willow pattern": "#2E6DB4",
  "blue grey": "#7090A8",
  "blue-grey": "#7090A8",
  "slate blue": "#6A78B0",
  "prussian blue": "#003153",

  // Green family
  mint: "#98D8B0",
  "mint green": "#98D8B0",
  "pale green": "#98C898",
  celadon: "#ACB899",
  "celadon green": "#ACB899",
  "forest green": "#228B22",
  "bottle green": "#1A5C1A",
  emerald: "#50C878",
  jade: "#00A36C",
  moss: "#8A9A5B",
  "moss green": "#8A9A5B",
  "hunter green": "#355E3B",
  willow: "#7A9E60",
  "willow green": "#7A9E60",
  "sage green": "#7A9E7E",
  lime: "#90C040",
  "lime green": "#90C040",
  "apple green": "#8DB600",
  "grass green": "#3A7D44",
  "dark green": "#1A5C1A",
  majolica: "#4E90A0",

  // Teal/turquoise family
  aqua: "#48BEAA",
  aquamarine: "#48BEAA",
  cyan: "#00B0B0",
  seafoam: "#70D8B8",
  "sea green": "#2E8B57",

  // Grey family
  gray: "#9E9E9E",
  silver: "#C8C8C8",
  "silver grey": "#C0C0C0",
  slate: "#708090",
  "slate grey": "#708090",
  "slate gray": "#708090",
  charcoal: "#404040",
  pewter: "#9090A0",
  ash: "#B2B0AE",
  smoke: "#8888A0",
  gunmetal: "#2C3539",
  platinum: "#C8C8D0",

  // Black/dark
  dark: "#2C2C2C",
  ebony: "#2C2C2C",

  // Special pottery/glaze terms
  rutile: "#8B7355",
  iron: "#4C4038",
  "iron red": "#B22222",
  flambe: "#A02020",
  "sang de boeuf": "#A02020",
  cerise: "#C22060",
  viridian: "#3A7D44",
};

/**
 * All resolved colour entries: canonical palette + aliases, keyed by lowercase name.
 * Longer keys are tried first during substring matching.
 */
const ALL_COLORS: Record<string, string> = { ...POTTERY_COLORS, ...ALIASES };

const SORTED_KEYS = Object.keys(ALL_COLORS).sort((a, b) => b.length - a.length);

/**
 * Return the hex value for any colour name.
 *
 * Resolution order:
 *  1. Exact match in the combined palette (canonical + aliases)
 *  2. Longest palette key that appears as a substring of `name`
 *  3. The name itself (works for plain CSS colour words like "blue", "red")
 */
export function colorToHex(name: string): string {
  const lower = name.trim().toLowerCase();

  // 1. Exact match
  if (ALL_COLORS[lower]) return ALL_COLORS[lower];

  // 2. Substring match — longest matching key wins
  for (const key of SORTED_KEYS) {
    if (lower.includes(key)) return ALL_COLORS[key];
  }

  // 3. Fall back to raw value (works for single-word CSS colour names)
  return name;
}

/** Names of all colours in the canonical palette, in display order. */
export const PALETTE_NAMES = Object.keys(POTTERY_COLORS);

// ---------------------------------------------------------------------------
// Category badge colour utilities
// ---------------------------------------------------------------------------

/**
 * A curated palette of pleasant background colours for category badges.
 * Varied enough to distinguish categories at a glance.
 */
export const CATEGORY_BG_PALETTE: string[] = [
  "#c0392b", // terracotta red
  "#d35400", // burnt orange
  "#d4a017", // amber gold
  "#27ae60", // forest green
  "#16a085", // teal
  "#2980b9", // cobalt blue
  "#8e44ad", // purple
  "#e91e63", // deep pink
  "#795548", // warm brown
  "#607d8b", // blue-grey slate
  "#1abc9c", // mint
  "#2c3e50", // dark navy
];

/**
 * Perceived brightness using the W3C/ITU-R BT.601 formula on a 0–255 scale.
 * Values above 128 read as "light" (dark text); at or below 128 read as "dark" (white text).
 */
export function perceivedBrightness(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/**
 * Return "#000000" for light backgrounds and "#ffffff" for dark backgrounds.
 * Falls back to black if the hex is invalid.
 */
export function autoTextColor(bgHex: string): string {
  try {
    return perceivedBrightness(bgHex) > 128 ? "#000000" : "#ffffff";
  } catch {
    return "#000000";
  }
}

/**
 * Pick a deterministic-ish but varied background colour for a new category.
 * Uses the category count so successive new categories rotate through the palette.
 */
export function suggestCategoryBgColor(existingCount: number): string {
  return CATEGORY_BG_PALETTE[existingCount % CATEGORY_BG_PALETTE.length];
}
