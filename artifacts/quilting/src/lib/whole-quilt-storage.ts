/**
 * Multi-design localStorage storage for the Whole-Quilt Designer.
 * Each design gets a UUID and lives in an array stored under DESIGNS_KEY.
 */

export type SeamLine = {
  axis: "h" | "v";
  pos: number;
  cellIdx: number;
  clipStart?: number;
  clipEnd?: number;
};

export interface SavedDesign {
  name: string;
  quiltRows: number;
  quiltCols: number;
  blockGridSize: number;
  cells: string[];
  seams: SeamLine[];
  primaryColor: string;
  secondaryColor: string;
  blockSizeInches: number | null;
  seamAllowanceInches: number;
  sashingEnabled: boolean;
  sashingWidthInches: number;
  sashingColor: string;
  borderEnabled: boolean;
  borderWidthInches: number;
  borderColor: string;
  cornerstoneEnabled: boolean;
  cornerstoneColor: string;
}

export interface WholequiltDesign extends SavedDesign {
  id: string;
  createdAt: string;
  updatedAt: string;
}

const DESIGNS_KEY = "quilting-whole-quilt-designs-v1";
const LEGACY_KEY_V4 = "quilting-whole-quilt-v4";
const LEGACY_KEY_V3 = "quilting-whole-quilt-v3";
const LEGACY_KEY_V2 = "quilting-whole-quilt-v2";
const LEGACY_KEY_V1 = "quilting-whole-quilt-v1";

const DEFAULTS: Pick<
  SavedDesign,
  | "blockSizeInches"
  | "seamAllowanceInches"
  | "sashingEnabled"
  | "sashingWidthInches"
  | "sashingColor"
  | "borderEnabled"
  | "borderWidthInches"
  | "borderColor"
  | "cornerstoneEnabled"
  | "cornerstoneColor"
> = {
  blockSizeInches: null,
  seamAllowanceInches: 0.25,
  sashingEnabled: false,
  sashingWidthInches: 1.5,
  sashingColor: "#d4c5a9",
  borderEnabled: false,
  borderWidthInches: 3,
  borderColor: "#8b6f5e",
  cornerstoneEnabled: false,
  cornerstoneColor: "#8b6f5e",
};

function seamLineFromKey(key: string): SeamLine | null {
  const parts = key.split(":");
  if (parts.length !== 3 || (parts[0] !== "h" && parts[0] !== "v")) return null;
  return {
    axis: parts[0] as "h" | "v",
    pos: Number(parts[1]),
    cellIdx: Number(parts[2]),
  };
}

/** Read an old single-design v4 (or earlier) from localStorage, return a full SavedDesign or null. */
function readLegacySingle(): SavedDesign | null {
  try {
    const v4 = localStorage.getItem(LEGACY_KEY_V4);
    if (v4) return { ...DEFAULTS, ...(JSON.parse(v4) as SavedDesign) };
    const v3 = localStorage.getItem(LEGACY_KEY_V3);
    if (v3)
      return {
        ...DEFAULTS,
        ...(JSON.parse(v3) as Omit<SavedDesign, keyof typeof DEFAULTS>),
      };
    const v2 = localStorage.getItem(LEGACY_KEY_V2);
    if (v2) {
      const d = JSON.parse(v2) as { seams?: string[] } & Omit<
        SavedDesign,
        "seams"
      >;
      return {
        ...DEFAULTS,
        ...d,
        seams: (d.seams ?? [])
          .map(seamLineFromKey)
          .filter(Boolean) as SeamLine[],
      };
    }
    const v1 = localStorage.getItem(LEGACY_KEY_V1);
    if (v1) {
      const d = JSON.parse(v1) as { seams?: string[] } & Omit<
        SavedDesign,
        "seams"
      >;
      return {
        ...DEFAULTS,
        ...d,
        seams: (d.seams ?? [])
          .map((k) => {
            const parts = k.split(":");
            if (parts.length === 3 && (parts[0] === "h" || parts[0] === "v"))
              return {
                axis: parts[0] as "h" | "v",
                pos: Number(parts[1]) * 2,
                cellIdx: Number(parts[2]),
              };
            return null;
          })
          .filter(Boolean) as SeamLine[],
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function loadAllDesigns(): WholequiltDesign[] {
  try {
    const raw = localStorage.getItem(DESIGNS_KEY);
    if (raw) return JSON.parse(raw) as WholequiltDesign[];
  } catch {}
  return [];
}

export function saveAllDesigns(designs: WholequiltDesign[]): void {
  localStorage.setItem(DESIGNS_KEY, JSON.stringify(designs));
}

export function loadDesignById(id: string): WholequiltDesign | null {
  return loadAllDesigns().find((d) => d.id === id) ?? null;
}

export function upsertDesign(design: WholequiltDesign): void {
  const all = loadAllDesigns();
  const idx = all.findIndex((d) => d.id === design.id);
  if (idx >= 0) all[idx] = design;
  else all.unshift(design);
  saveAllDesigns(all);
}

export function deleteDesignById(id: string): void {
  saveAllDesigns(loadAllDesigns().filter((d) => d.id !== id));
}

/**
 * On first use, migrate an existing v1-v4 single design to the new multi-design array.
 * Returns true if something was migrated.
 */
export function migrateFromLegacy(): boolean {
  if (loadAllDesigns().length > 0) return false; // already migrated or new user
  const legacy = readLegacySingle();
  if (!legacy) return false;
  const now = new Date().toISOString();
  const migrated: WholequiltDesign = {
    ...legacy,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  saveAllDesigns([migrated]);
  // Remove old keys
  [LEGACY_KEY_V1, LEGACY_KEY_V2, LEGACY_KEY_V3, LEGACY_KEY_V4].forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  });
  return true;
}

/** Build a simple thumbnail SVG string for a design (solid colours only, no fabric images). */
export function buildWholequiltThumbnailSvg(
  design: WholequiltDesign,
  size = 160,
): string {
  const { quiltCols, quiltRows, blockGridSize, cells } = design;
  const totalCols = quiltCols * blockGridSize;
  const totalRows = quiltRows * blockGridSize;
  const cellPx = size / Math.max(totalCols, totalRows);
  const shapes: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    const col = i % totalCols;
    const row = Math.floor(i / totalCols);
    const c = cells[i];
    if (!c || c.startsWith("fab:")) {
      const fill = c ? "#9ca3af" : "#f3f4f6";
      shapes.push(
        `<rect x="${col * cellPx}" y="${row * cellPx}" width="${cellPx}" height="${cellPx}" fill="${fill}"/>`,
      );
    } else {
      shapes.push(
        `<rect x="${col * cellPx}" y="${row * cellPx}" width="${cellPx}" height="${cellPx}" fill="${c}"/>`,
      );
    }
  }
  const w = totalCols * cellPx;
  const h = totalRows * cellPx;
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect width="${w}" height="${h}" fill="#f3f4f6"/>${shapes.join("")}</svg>`;
}
