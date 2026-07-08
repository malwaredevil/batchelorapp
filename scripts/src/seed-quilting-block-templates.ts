/**
 * Seed the Quilting Block Library with an extensive set of classic /
 * traditional named quilt block templates.
 *
 * Uses the running API server's session-authenticated
 * POST /api/quilting/block-templates route (not direct DB access), so all
 * the same Zod validation the app itself uses applies.
 *
 * Usage: pnpm --filter @workspace/scripts run seed-quilting-block-templates
 *
 * Requires AGENT_LOGIN_EMAIL / AGENT_LOGIN_PASSWORD and REPLIT_DEV_DOMAIN
 * (or API_BASE_URL) to be set in the environment.
 */

export {};

const BASE_URL =
  process.env.API_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : undefined);

if (!BASE_URL) {
  console.error("REPLIT_DEV_DOMAIN or API_BASE_URL must be set");
  process.exit(1);
}

const EMAIL = process.env.AGENT_LOGIN_EMAIL;
const PASSWORD = process.env.AGENT_LOGIN_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("AGENT_LOGIN_EMAIL / AGENT_LOGIN_PASSWORD must be set");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const LIGHT = "#F7F2E7"; // background / muslin
const DARK = "#22406B"; // navy
const RED = "#B33A3A"; // turkey red
const GOLD = "#D2A23A"; // mustard gold
const GREEN = "#3F6E52"; // forest green

// ---------------------------------------------------------------------------
// Cell-string helpers (see artifacts/quilting/src/lib/cell-parser.ts)
// ---------------------------------------------------------------------------

const solid = (c: string) => c;
const nwse = (a: string, b: string) => `nwse:${a}:${b}`;
const nesw = (a: string, b: string) => `nesw:${a}:${b}`;
const quad = (t: string, r: string, b: string, l: string) =>
  `quad:${t}:${r}:${b}:${l}`;
const hsplit = (t: string, b: string) => `hsplit:${t}:${b}`;
const vsplit = (l: string, r: string) => `vsplit:${l}:${r}`;
const xsplit = (tl: string, tr: string, bl: string, br: string) =>
  `xsplit:${tl}:${tr}:${bl}:${br}`;

interface TemplateDef {
  name: string;
  tags: string[];
  gridW: number;
  gridH: number;
  cells: string[];
  blockSizeInches?: number;
  seamAllowanceInches?: number;
}

const CLASSIC = "Classic";

function t(
  name: string,
  tags: string[],
  gridW: number,
  gridH: number,
  cells: string[],
): TemplateDef {
  if (cells.length !== gridW * gridH) {
    throw new Error(
      `${name}: expected ${gridW * gridH} cells, got ${cells.length}`,
    );
  }
  return {
    name,
    tags: [CLASSIC, ...tags],
    gridW,
    gridH,
    cells,
    blockSizeInches: 12,
    seamAllowanceInches: 0.25,
  };
}

// ---------------------------------------------------------------------------
// Block definitions
// ---------------------------------------------------------------------------

const TEMPLATES: TemplateDef[] = [
  // ── Four-patch family (2x2 / 1x1) ────────────────────────────────────────
  t("Four Patch", ["Four Patch", "Beginner"], 2, 2, [
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
  ]),
  t("Hourglass", ["Four Patch", "Beginner"], 1, 1, [
    quad(LIGHT, DARK, LIGHT, DARK),
  ]),
  t("Bow Tie", ["Four Patch"], 1, 1, [quad(DARK, LIGHT, DARK, LIGHT)]),
  t("Broken Dishes", ["Four Patch", "Pinwheel"], 2, 2, [
    nwse(LIGHT, DARK),
    nesw(LIGHT, DARK),
    nesw(DARK, LIGHT),
    nwse(DARK, LIGHT),
  ]),
  t("Pinwheel", ["Four Patch", "Pinwheel"], 2, 2, [
    nwse(LIGHT, DARK),
    nesw(DARK, LIGHT),
    nesw(LIGHT, DARK),
    nwse(DARK, LIGHT),
  ]),
  t("Windmill", ["Four Patch", "Pinwheel"], 2, 2, [
    nesw(LIGHT, GOLD),
    nwse(GOLD, LIGHT),
    nwse(LIGHT, GOLD),
    nesw(GOLD, LIGHT),
  ]),
  t("Yankee Puzzle", ["Four Patch", "Pinwheel"], 2, 2, [
    nwse(LIGHT, RED),
    nesw(RED, LIGHT),
    nesw(LIGHT, RED),
    nwse(RED, LIGHT),
  ]),
  t("Windblown Square", ["Four Patch", "Pinwheel"], 2, 2, [
    nesw(DARK, GOLD),
    nwse(GOLD, DARK),
    nwse(DARK, GOLD),
    nesw(GOLD, DARK),
  ]),
  t("Double Pinwheel", ["Four Patch", "Pinwheel"], 4, 4, [
    nwse(LIGHT, DARK),
    nesw(DARK, LIGHT),
    nwse(LIGHT, RED),
    nesw(RED, LIGHT),
    nesw(LIGHT, DARK),
    nwse(DARK, LIGHT),
    nesw(RED, LIGHT),
    nwse(LIGHT, RED),
    nwse(LIGHT, RED),
    nesw(RED, LIGHT),
    nwse(LIGHT, DARK),
    nesw(DARK, LIGHT),
    nesw(RED, LIGHT),
    nwse(LIGHT, RED),
    nesw(LIGHT, DARK),
    nwse(DARK, LIGHT),
  ]),
  t("Dutch Windmill", ["Four Patch", "Pinwheel"], 4, 4, [
    nesw(LIGHT, GREEN),
    nwse(GREEN, LIGHT),
    nesw(LIGHT, GOLD),
    nwse(GOLD, LIGHT),
    nwse(GREEN, LIGHT),
    nesw(LIGHT, GREEN),
    nwse(GOLD, LIGHT),
    nesw(LIGHT, GOLD),
    nwse(GOLD, LIGHT),
    nesw(LIGHT, GOLD),
    nwse(GREEN, LIGHT),
    nesw(LIGHT, GREEN),
    nesw(LIGHT, GOLD),
    nwse(GOLD, LIGHT),
    nesw(LIGHT, GREEN),
    nwse(GREEN, LIGHT),
  ]),

  // ── Rail Fence / Strips ──────────────────────────────────────────────────
  t("Rail Fence", ["Strips", "Beginner"], 4, 4, [
    solid(LIGHT),
    solid(DARK),
    solid(GOLD),
    solid(RED),
    solid(LIGHT),
    solid(DARK),
    solid(GOLD),
    solid(RED),
    solid(LIGHT),
    solid(DARK),
    solid(GOLD),
    solid(RED),
    solid(LIGHT),
    solid(DARK),
    solid(GOLD),
    solid(RED),
  ]),
  t(
    "Log Cabin",
    ["Strips", "Traditional"],
    8,
    8,
    (() => {
      const N = 8;
      const cells: string[] = [];
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (r === N / 2 - 1 && c === N / 2 - 1) {
            cells.push(solid(RED)); // hearth centre
          } else if (r < c) {
            cells.push(solid(LIGHT));
          } else {
            cells.push(solid(DARK));
          }
        }
      }
      return cells;
    })(),
  ),
  t(
    "Courthouse Steps",
    ["Strips", "Traditional"],
    7,
    7,
    (() => {
      const N = 7;
      const mid = Math.floor(N / 2);
      const cells: string[] = [];
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (r === mid && c === mid) cells.push(solid(RED));
          else if (r === mid) cells.push(c < mid ? solid(DARK) : solid(LIGHT));
          else if (c === mid) cells.push(r < mid ? solid(LIGHT) : solid(DARK));
          else if (Math.abs(r - mid) > Math.abs(c - mid))
            cells.push(r < mid ? solid(LIGHT) : solid(DARK));
          else cells.push(c < mid ? solid(DARK) : solid(LIGHT));
        }
      }
      return cells;
    })(),
  ),
  t("Streak of Lightning", ["Strips", "Zigzag"], 4, 4, [
    nesw(LIGHT, DARK),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    nesw(LIGHT, DARK),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    nesw(LIGHT, DARK),
    solid(DARK),
    solid(DARK),
    solid(DARK),
    solid(LIGHT),
    nesw(LIGHT, DARK),
  ]),

  // ── Flying Geese ─────────────────────────────────────────────────────────
  t("Flying Geese", ["Triangles", "Beginner"], 1, 1, [
    quad(DARK, LIGHT, LIGHT, LIGHT),
  ]),
  t("Wild Goose Chase", ["Triangles", "Strips"], 4, 1, [
    quad(DARK, LIGHT, LIGHT, LIGHT),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    quad(DARK, LIGHT, LIGHT, LIGHT),
  ]),
  t("Dutchman's Puzzle", ["Triangles", "Pinwheel"], 4, 4, [
    quad(LIGHT, LIGHT, DARK, LIGHT),
    quad(LIGHT, LIGHT, LIGHT, DARK),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    quad(LIGHT, LIGHT, LIGHT, DARK),
    solid(LIGHT),
    solid(LIGHT),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    quad(LIGHT, LIGHT, DARK, LIGHT),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    quad(LIGHT, LIGHT, LIGHT, DARK),
    quad(LIGHT, LIGHT, DARK, LIGHT),
  ]),

  // ── Nine-patch star family ───────────────────────────────────────────────
  t("Nine Patch", ["Nine Patch", "Beginner"], 3, 3, [
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
  ]),
  t("Shoofly", ["Nine Patch", "Star"], 3, 3, [
    nesw(LIGHT, DARK),
    solid(LIGHT),
    nwse(LIGHT, DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    nwse(DARK, LIGHT),
    solid(LIGHT),
    nesw(DARK, LIGHT),
  ]),
  t("Ohio Star", ["Nine Patch", "Star"], 3, 3, [
    solid(LIGHT),
    nesw(LIGHT, DARK),
    solid(LIGHT),
    nesw(LIGHT, DARK),
    solid(DARK),
    nwse(LIGHT, DARK),
    solid(LIGHT),
    nwse(DARK, LIGHT),
    solid(LIGHT),
  ]),
  t("Friendship Star", ["Nine Patch", "Star"], 3, 3, [
    nesw(DARK, LIGHT),
    solid(LIGHT),
    nwse(DARK, LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    nwse(LIGHT, DARK),
    solid(LIGHT),
    nesw(LIGHT, DARK),
  ]),
  t("Sawtooth Star", ["Nine Patch", "Star"], 3, 3, [
    solid(LIGHT),
    quad(LIGHT, LIGHT, DARK, LIGHT),
    solid(LIGHT),
    quad(LIGHT, LIGHT, LIGHT, DARK),
    solid(RED),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    solid(LIGHT),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    solid(LIGHT),
  ]),
  t("King's Crown", ["Nine Patch", "Star"], 3, 3, [
    nesw(RED, LIGHT),
    solid(DARK),
    nwse(RED, LIGHT),
    solid(DARK),
    solid(RED),
    solid(DARK),
    nwse(LIGHT, RED),
    solid(DARK),
    nesw(LIGHT, RED),
  ]),
  t("Crosses and Losses", ["Nine Patch", "Star"], 3, 3, [
    nesw(GOLD, LIGHT),
    solid(LIGHT),
    nwse(GOLD, LIGHT),
    solid(LIGHT),
    solid(GOLD),
    solid(LIGHT),
    nwse(LIGHT, GOLD),
    solid(LIGHT),
    nesw(LIGHT, GOLD),
  ]),
  t("North Wind", ["Nine Patch", "Star"], 3, 3, [
    solid(LIGHT),
    nesw(LIGHT, GREEN),
    solid(LIGHT),
    nesw(LIGHT, GREEN),
    quad(GREEN, LIGHT, GREEN, LIGHT),
    nwse(LIGHT, GREEN),
    solid(LIGHT),
    nwse(GREEN, LIGHT),
    solid(LIGHT),
  ]),
  t("Contrary Wife", ["Nine Patch", "Star"], 3, 3, [
    nesw(DARK, LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    nwse(LIGHT, DARK),
    solid(DARK),
    solid(LIGHT),
    nesw(LIGHT, DARK),
  ]),
  t("Old Maid's Puzzle", ["Nine Patch", "Star"], 3, 3, [
    quad(LIGHT, LIGHT, RED, LIGHT),
    solid(LIGHT),
    quad(LIGHT, LIGHT, LIGHT, RED),
    solid(LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    quad(LIGHT, RED, LIGHT, LIGHT),
    solid(LIGHT),
    quad(RED, LIGHT, LIGHT, LIGHT),
  ]),
  t("Rolling Stone", ["Nine Patch", "Star"], 3, 3, [
    solid(DARK),
    nesw(LIGHT, DARK),
    solid(DARK),
    nwse(LIGHT, DARK),
    quad(DARK, LIGHT, DARK, LIGHT),
    nesw(DARK, LIGHT),
    solid(DARK),
    nwse(DARK, LIGHT),
    solid(DARK),
  ]),
  t("Buckeye Beauty", ["Nine Patch", "Star"], 3, 3, [
    quad(RED, LIGHT, LIGHT, LIGHT),
    solid(LIGHT),
    quad(LIGHT, LIGHT, LIGHT, RED),
    solid(LIGHT),
    quad(LIGHT, RED, LIGHT, RED),
    solid(LIGHT),
    quad(LIGHT, LIGHT, RED, LIGHT),
    solid(LIGHT),
    quad(LIGHT, LIGHT, LIGHT, RED),
  ]),
  t("Monkey Wrench", ["Nine Patch", "Traditional"], 3, 3, [
    nesw(DARK, LIGHT),
    solid(LIGHT),
    nwse(DARK, LIGHT),
    solid(LIGHT),
    quad(DARK, LIGHT, DARK, LIGHT),
    solid(LIGHT),
    nwse(LIGHT, DARK),
    solid(LIGHT),
    nesw(LIGHT, DARK),
  ]),
  t("Churn Dash", ["Nine Patch", "Traditional"], 3, 3, [
    solid(DARK),
    hsplit(DARK, LIGHT),
    solid(DARK),
    vsplit(DARK, LIGHT),
    solid(LIGHT),
    vsplit(LIGHT, DARK),
    solid(DARK),
    hsplit(LIGHT, DARK),
    solid(DARK),
  ]),
  t("Economy Block", ["Nine Patch", "Traditional"], 3, 3, [
    solid(LIGHT),
    nesw(LIGHT, DARK),
    solid(LIGHT),
    nwse(LIGHT, DARK),
    solid(DARK),
    nesw(DARK, LIGHT),
    solid(LIGHT),
    nwse(DARK, LIGHT),
    solid(LIGHT),
  ]),
  t("Puss in the Corner", ["Nine Patch", "Beginner"], 3, 3, [
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
  ]),
  t("Bright Hopes", ["Nine Patch", "Frame"], 3, 3, [
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(GOLD),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
  ]),
  t("Album Block", ["Nine Patch", "Frame"], 3, 3, [
    solid(LIGHT),
    solid(RED),
    solid(LIGHT),
    solid(RED),
    solid(DARK),
    solid(RED),
    solid(LIGHT),
    solid(RED),
    solid(LIGHT),
  ]),
  t("Card Trick", ["Nine Patch", "Pinwheel"], 3, 3, [
    nwse(LIGHT, DARK),
    nesw(LIGHT, DARK),
    nwse(DARK, LIGHT),
    nesw(DARK, LIGHT),
    solid(GOLD),
    nesw(LIGHT, DARK),
    nwse(LIGHT, DARK),
    nwse(DARK, LIGHT),
    nesw(DARK, LIGHT),
  ]),
  t("Spool", ["Nine Patch", "Traditional"], 3, 3, [
    solid(LIGHT),
    nesw(LIGHT, DARK),
    solid(LIGHT),
    nwse(DARK, LIGHT),
    solid(DARK),
    nesw(LIGHT, DARK),
    solid(LIGHT),
    nwse(DARK, LIGHT),
    solid(LIGHT),
  ]),
  t("Jacob's Ladder", ["Nine Patch", "Traditional"], 4, 4, [
    solid(LIGHT),
    solid(DARK),
    nwse(LIGHT, DARK),
    nesw(LIGHT, DARK),
    solid(DARK),
    solid(LIGHT),
    nesw(LIGHT, DARK),
    nwse(LIGHT, DARK),
    nwse(DARK, LIGHT),
    nesw(DARK, LIGHT),
    solid(LIGHT),
    solid(DARK),
    nesw(DARK, LIGHT),
    nwse(DARK, LIGHT),
    solid(DARK),
    solid(LIGHT),
  ]),
  t("Corn and Beans", ["Nine Patch", "Traditional"], 4, 4, [
    solid(GREEN),
    solid(LIGHT),
    nwse(LIGHT, GOLD),
    nesw(LIGHT, GOLD),
    solid(LIGHT),
    solid(GREEN),
    nesw(LIGHT, GOLD),
    nwse(LIGHT, GOLD),
    nwse(GOLD, LIGHT),
    nesw(GOLD, LIGHT),
    solid(GREEN),
    solid(LIGHT),
    nesw(GOLD, LIGHT),
    nwse(GOLD, LIGHT),
    solid(LIGHT),
    solid(GREEN),
  ]),
  t("Snail's Trail", ["Traditional", "Spiral"], 4, 4, [
    nwse(LIGHT, DARK),
    solid(DARK),
    solid(DARK),
    nesw(LIGHT, DARK),
    solid(LIGHT),
    nwse(LIGHT, DARK),
    nesw(LIGHT, DARK),
    solid(DARK),
    solid(LIGHT),
    nesw(DARK, LIGHT),
    nwse(DARK, LIGHT),
    solid(DARK),
    nesw(DARK, LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    nwse(DARK, LIGHT),
  ]),
  t("Goose in the Pond", ["Traditional", "Star"], 5, 5, [
    solid(DARK),
    quad(LIGHT, LIGHT, DARK, LIGHT),
    solid(DARK),
    quad(LIGHT, LIGHT, DARK, LIGHT),
    solid(DARK),
    quad(LIGHT, LIGHT, LIGHT, DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(GOLD),
    solid(LIGHT),
    solid(DARK),
    quad(LIGHT, LIGHT, LIGHT, DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    solid(DARK),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    solid(DARK),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    solid(DARK),
  ]),
  t("Fox and Geese", ["Traditional", "Triangles"], 3, 3, [
    quad(LIGHT, LIGHT, DARK, LIGHT),
    solid(DARK),
    quad(LIGHT, LIGHT, DARK, LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    solid(DARK),
    quad(DARK, LIGHT, LIGHT, LIGHT),
  ]),
  t("Hovering Hawks", ["Traditional", "Triangles"], 4, 4, [
    solid(LIGHT),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    quad(LIGHT, LIGHT, LIGHT, DARK),
    solid(LIGHT),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    solid(RED),
    solid(RED),
    quad(LIGHT, LIGHT, DARK, LIGHT),
    quad(LIGHT, LIGHT, DARK, LIGHT),
    solid(RED),
    solid(RED),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    solid(LIGHT),
    quad(LIGHT, LIGHT, LIGHT, DARK),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    solid(LIGHT),
  ]),
  t("Mosaic", ["Traditional", "Nine Patch"], 3, 3, [
    nwse(LIGHT, DARK),
    solid(LIGHT),
    nesw(LIGHT, DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    nesw(DARK, LIGHT),
    solid(LIGHT),
    nwse(DARK, LIGHT),
  ]),
  t("Sherman's March", ["Traditional", "Strips"], 4, 4, [
    solid(DARK),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(GOLD),
    solid(GOLD),
    solid(LIGHT),
    solid(LIGHT),
    solid(GOLD),
    solid(GOLD),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(DARK),
  ]),
  t("Storm at Sea", ["Traditional", "Star"], 4, 4, [
    solid(LIGHT),
    quad(LIGHT, DARK, DARK, LIGHT),
    quad(LIGHT, LIGHT, DARK, DARK),
    solid(LIGHT),
    quad(LIGHT, LIGHT, DARK, DARK),
    solid(GOLD),
    solid(GOLD),
    quad(DARK, LIGHT, LIGHT, DARK),
    quad(DARK, DARK, LIGHT, LIGHT),
    solid(GOLD),
    solid(GOLD),
    quad(LIGHT, DARK, DARK, LIGHT),
    solid(LIGHT),
    quad(DARK, DARK, LIGHT, LIGHT),
    quad(DARK, LIGHT, LIGHT, DARK),
    solid(LIGHT),
  ]),
  t("Maple Leaf", ["Traditional", "Nature"], 3, 3, [
    solid(LIGHT),
    nesw(LIGHT, GREEN),
    solid(LIGHT),
    nwse(LIGHT, GREEN),
    solid(GREEN),
    solid(LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    nwse(LIGHT, DARK),
  ]),
  t("Bear's Paw", ["Traditional", "Nature"], 6, 6, [
    quad(LIGHT, LIGHT, DARK, LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    quad(LIGHT, LIGHT, LIGHT, DARK),
    solid(DARK),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(RED),
    solid(RED),
    solid(LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    solid(RED),
    solid(RED),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(DARK),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    quad(LIGHT, DARK, LIGHT, LIGHT),
  ]),

  // ── Miscellaneous simple traditional blocks ─────────────────────────────
  t("Bear Tracks", ["Traditional", "Nature"], 3, 3, [
    quad(LIGHT, LIGHT, DARK, LIGHT),
    solid(LIGHT),
    quad(LIGHT, LIGHT, LIGHT, DARK),
    solid(LIGHT),
    solid(GOLD),
    solid(LIGHT),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    solid(LIGHT),
    quad(DARK, LIGHT, LIGHT, LIGHT),
  ]),
  t("Tree of Paradise", ["Traditional", "Nature"], 3, 3, [
    nesw(LIGHT, GREEN),
    solid(GREEN),
    nwse(LIGHT, GREEN),
    solid(GREEN),
    solid(DARK),
    solid(GREEN),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
  ]),
  t("Pinwheel Star", ["Star", "Pinwheel"], 3, 3, [
    nesw(LIGHT, GOLD),
    solid(LIGHT),
    nwse(GOLD, LIGHT),
    solid(LIGHT),
    quad(GOLD, LIGHT, GOLD, LIGHT),
    solid(LIGHT),
    nwse(LIGHT, GOLD),
    solid(LIGHT),
    nesw(GOLD, LIGHT),
  ]),
  t("Turnstile", ["Pinwheel", "Nine Patch"], 3, 3, [
    nesw(DARK, LIGHT),
    solid(LIGHT),
    nwse(LIGHT, DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    nwse(DARK, LIGHT),
    solid(LIGHT),
    nesw(LIGHT, DARK),
  ]),
  t("Weathervane", ["Traditional", "Nine Patch"], 3, 3, [
    solid(DARK),
    hsplit(LIGHT, DARK),
    solid(DARK),
    vsplit(DARK, LIGHT),
    solid(LIGHT),
    vsplit(LIGHT, DARK),
    solid(DARK),
    hsplit(DARK, LIGHT),
    solid(DARK),
  ]),
  t("Cats and Mice", ["Traditional", "Nine Patch"], 3, 3, [
    quad(LIGHT, LIGHT, DARK, LIGHT),
    solid(DARK),
    quad(LIGHT, LIGHT, DARK, LIGHT),
    solid(LIGHT),
    solid(RED),
    solid(LIGHT),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    solid(DARK),
    quad(DARK, LIGHT, LIGHT, LIGHT),
  ]),
  t("Air Castle", ["Traditional", "Star"], 3, 3, [
    solid(LIGHT),
    quad(LIGHT, LIGHT, DARK, LIGHT),
    solid(LIGHT),
    quad(LIGHT, LIGHT, LIGHT, DARK),
    solid(GOLD),
    quad(LIGHT, DARK, LIGHT, LIGHT),
    solid(LIGHT),
    quad(DARK, LIGHT, LIGHT, LIGHT),
    solid(LIGHT),
  ]),
  t("Anvil", ["Traditional", "Nine Patch"], 3, 3, [
    solid(DARK),
    solid(LIGHT),
    nwse(LIGHT, DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    nesw(LIGHT, DARK),
    solid(LIGHT),
    solid(DARK),
  ]),
  t("Arrowhead", ["Traditional", "Triangles"], 2, 2, [
    nesw(LIGHT, DARK),
    nwse(DARK, LIGHT),
    solid(LIGHT),
    solid(LIGHT),
  ]),
  t("Basket Weave", ["Traditional", "Strips"], 4, 4, [
    solid(DARK),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(DARK),
  ]),
  t("Checkerboard", ["Beginner", "Nine Patch"], 4, 4, [
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
  ]),
  t("Diamond in a Square", ["Traditional", "Star"], 3, 3, [
    solid(LIGHT),
    nesw(LIGHT, GOLD),
    solid(LIGHT),
    nesw(LIGHT, GOLD),
    solid(GOLD),
    nwse(LIGHT, GOLD),
    solid(LIGHT),
    nwse(LIGHT, GOLD),
    solid(LIGHT),
  ]),
  t("Formal Garden", ["Traditional", "Frame"], 3, 3, [
    solid(GREEN),
    solid(LIGHT),
    solid(GREEN),
    solid(LIGHT),
    solid(RED),
    solid(LIGHT),
    solid(GREEN),
    solid(LIGHT),
    solid(GREEN),
  ]),
  t("Grandmother's Choice", ["Traditional", "Nine Patch"], 3, 3, [
    solid(DARK),
    nesw(DARK, LIGHT),
    solid(DARK),
    nwse(DARK, LIGHT),
    solid(LIGHT),
    nesw(LIGHT, DARK),
    solid(DARK),
    nwse(LIGHT, DARK),
    solid(DARK),
  ]),
  t("Kansas Troubles", ["Traditional", "Triangles"], 4, 4, [
    solid(LIGHT),
    quad(RED, LIGHT, LIGHT, LIGHT),
    quad(LIGHT, LIGHT, LIGHT, RED),
    solid(LIGHT),
    quad(LIGHT, LIGHT, LIGHT, RED),
    solid(LIGHT),
    solid(LIGHT),
    quad(RED, LIGHT, LIGHT, LIGHT),
    quad(LIGHT, RED, LIGHT, LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    quad(LIGHT, LIGHT, RED, LIGHT),
    solid(LIGHT),
    quad(LIGHT, LIGHT, RED, LIGHT),
    quad(LIGHT, RED, LIGHT, LIGHT),
    solid(LIGHT),
  ]),
  t("Lady of the Lake", ["Traditional", "Triangles"], 4, 4, [
    nwse(LIGHT, DARK),
    nwse(LIGHT, DARK),
    nesw(DARK, LIGHT),
    nesw(DARK, LIGHT),
    nwse(LIGHT, DARK),
    solid(DARK),
    solid(DARK),
    nesw(DARK, LIGHT),
    nesw(LIGHT, DARK),
    solid(DARK),
    solid(DARK),
    nwse(DARK, LIGHT),
    nesw(LIGHT, DARK),
    nesw(LIGHT, DARK),
    nwse(DARK, LIGHT),
    nwse(DARK, LIGHT),
  ]),
  t("Milky Way", ["Traditional", "Star"], 3, 3, [
    nesw(LIGHT, DARK),
    solid(GOLD),
    nwse(LIGHT, DARK),
    solid(GOLD),
    solid(DARK),
    solid(GOLD),
    nwse(DARK, LIGHT),
    solid(GOLD),
    nesw(DARK, LIGHT),
  ]),
  t("Ocean Waves", ["Traditional", "Triangles"], 4, 4, [
    nwse(LIGHT, DARK),
    nwse(LIGHT, DARK),
    nwse(LIGHT, DARK),
    nwse(LIGHT, DARK),
    nesw(LIGHT, DARK),
    nesw(LIGHT, DARK),
    nesw(LIGHT, DARK),
    nesw(LIGHT, DARK),
    nwse(LIGHT, DARK),
    nwse(LIGHT, DARK),
    nwse(LIGHT, DARK),
    nwse(LIGHT, DARK),
    nesw(LIGHT, DARK),
    nesw(LIGHT, DARK),
    nesw(LIGHT, DARK),
    nesw(LIGHT, DARK),
  ]),
  t("Road to California", ["Traditional", "Star"], 3, 3, [
    solid(DARK),
    nwse(DARK, LIGHT),
    solid(DARK),
    nesw(DARK, LIGHT),
    solid(LIGHT),
    nesw(LIGHT, DARK),
    solid(DARK),
    nwse(LIGHT, DARK),
    solid(DARK),
  ]),
  t("Steps to the Altar", ["Traditional", "Strips"], 4, 4, [
    solid(LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(LIGHT),
    solid(LIGHT),
    solid(DARK),
    solid(DARK),
    solid(LIGHT),
    solid(DARK),
    solid(DARK),
    solid(DARK),
    solid(DARK),
    solid(DARK),
    solid(DARK),
    solid(DARK),
  ]),
  t("Union Square", ["Traditional", "Nine Patch"], 3, 3, [
    solid(DARK),
    solid(GOLD),
    solid(DARK),
    solid(GOLD),
    solid(RED),
    solid(GOLD),
    solid(DARK),
    solid(GOLD),
    solid(DARK),
  ]),
  t("Whirligig", ["Pinwheel", "Star"], 4, 4, [
    nesw(LIGHT, RED),
    solid(LIGHT),
    solid(LIGHT),
    nwse(RED, LIGHT),
    solid(LIGHT),
    nesw(LIGHT, RED),
    nwse(RED, LIGHT),
    solid(LIGHT),
    solid(LIGHT),
    nwse(LIGHT, RED),
    nesw(RED, LIGHT),
    solid(LIGHT),
    nwse(LIGHT, RED),
    solid(LIGHT),
    solid(LIGHT),
    nesw(RED, LIGHT),
  ]),
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Logging in as ${EMAIL}...`);
  const jar: string[] = [];

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(
      `Login failed: ${loginRes.status} ${await loginRes.text()}`,
    );
  }
  const setCookie = loginRes.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const pair = c.split(";")[0];
    if (pair) jar.push(pair);
  }
  const cookieHeader = jar.join("; ");
  if (!cookieHeader) throw new Error("No session cookie received from login");

  console.log(`Seeding ${TEMPLATES.length} classic block templates...`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  const listRes = await fetch(`${BASE_URL}/api/quilting/block-templates`, {
    headers: { Cookie: cookieHeader },
  });
  const existing: Array<{ name: string }> = listRes.ok
    ? ((await listRes.json()) as Array<{ name: string }>)
    : [];
  const existingNames = new Set(existing.map((r) => r.name));

  for (const template of TEMPLATES) {
    if (existingNames.has(template.name)) {
      console.log(`  skip (already exists): ${template.name}`);
      skipped++;
      continue;
    }
    const res = await fetch(`${BASE_URL}/api/quilting/block-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({
        name: template.name,
        tags: template.tags,
        gridW: template.gridW,
        gridH: template.gridH,
        cells: template.cells,
        blockSizeInches: template.blockSizeInches ?? null,
        seamAllowanceInches: template.seamAllowanceInches ?? null,
      }),
    });
    if (!res.ok) {
      console.error(
        `  FAILED: ${template.name} — ${res.status} ${await res.text()}`,
      );
      failed++;
      continue;
    }
    console.log(`  created: ${template.name}`);
    created++;
  }

  console.log(
    `\nDone. Created ${created}, skipped ${skipped} (already existed), failed ${failed}.`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
