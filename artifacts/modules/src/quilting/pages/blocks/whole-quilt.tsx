import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
} from "react";
import { useSearch, useLocation } from "wouter";
import { useRegisterNavGuard } from "@/quilting/lib/nav-guard";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";
import {
  ArrowLeft,
  Save,
  Trash2,
  RotateCcw,
  Paintbrush,
  Eraser,
  PaintBucket,
  Pipette,
  Hand,
  Download,
  FilePlus2,
  Scissors,
  Eye,
  EyeOff,
  Wand2,
  GripVertical,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  parseCell,
  encodeXline,
  applyDiagClip,
  toggleQuarterLine,
  quarterDirForClick,
  fmtInch,
} from "@/quilting/lib/cell-parser";
import { useCreateBlock, useListFabrics } from "@workspace/api-client-react";
import {
  FabricPicker,
  computeFabricTally,
  buildFabricUrlMap,
} from "@/quilting/components/FabricPicker";
import {
  BlockGrid,
  BlockRuler,
  RULER_THICK,
  type SeamLine,
  seamFill,
} from "./designer";
import {
  loadDesignById,
  upsertDesign,
  type WholequiltDesign,
} from "@/quilting/lib/whole-quilt-storage";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PALETTE: string[] = [
  "#FFFFFF",
  "#FFF8F0",
  "#F5EFE7",
  "#EDE0D4",
  "#C0392B",
  "#E74C3C",
  "#FF6B6B",
  "#FF8FA3",
  "#D63384",
  "#FF69B4",
  "#F48FB1",
  "#F8BBD0",
  "#E67E22",
  "#F39C12",
  "#FFB347",
  "#FFE066",
  "#FFF176",
  "#F9A825",
  "#FFECB3",
  "#FFD54F",
  "#27AE60",
  "#2ECC71",
  "#82C91E",
  "#C5E1A5",
  "#80CBC4",
  "#4DB6AC",
  "#26A69A",
  "#00897B",
  "#2980B9",
  "#3498DB",
  "#5DADE2",
  "#90CAF9",
  "#1565C0",
  "#283593",
  "#5C6BC0",
  "#7986CB",
  "#8E44AD",
  "#9B59B6",
  "#CE93D8",
  "#E1BEE7",
  "#7B1FA2",
  "#6A1B9A",
  "#BA68C8",
  "#F3E5F5",
  "#795548",
  "#8D6E63",
  "#A1887F",
  "#D7CCC8",
  "#212121",
  "#424242",
  "#757575",
  "#BDBDBD",
  "#E0E0E0",
  "#F5F5F5",
  "#263238",
  "#546E7A",
];

const STORAGE_KEY = "quilting-whole-quilt-v4";
const LEGACY_KEY_V3 = "quilting-whole-quilt-v3";
const LEGACY_KEY_V2 = "quilting-whole-quilt-v2";
const LEGACY_KEY_V1 = "quilting-whole-quilt-v1";

const DEFAULT_SASHING_COLOR = "#d4c5a9";
const DEFAULT_BORDER_COLOR = "#8b6f5e";
const DEFAULT_CORNERSTONE_COLOR = "#8b6f5e";

type WholeTool =
  | "paint"
  | "erase"
  | "fill"
  | "eyedropper"
  | "pan"
  | "tri-nwse"
  | "tri-nesw"
  | "seam-h"
  | "seam-v"
  | "line-nwse"
  | "line-nesw"
  | "qline-back"
  | "qline-fwd"
  | "seam-snip";

// ---------------------------------------------------------------------------
// Saved state
// ---------------------------------------------------------------------------

interface SavedDesign {
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

const SAVED_DESIGN_DEFAULTS: Pick<
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
  sashingColor: DEFAULT_SASHING_COLOR,
  borderEnabled: false,
  borderWidthInches: 3,
  borderColor: DEFAULT_BORDER_COLOR,
  cornerstoneEnabled: false,
  cornerstoneColor: DEFAULT_CORNERSTONE_COLOR,
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

function loadDesign(): SavedDesign | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw)
      return { ...SAVED_DESIGN_DEFAULTS, ...(JSON.parse(raw) as SavedDesign) };
    // v3 → v4: add new layout fields with defaults
    const v3 = localStorage.getItem(LEGACY_KEY_V3);
    if (v3)
      return {
        ...SAVED_DESIGN_DEFAULTS,
        ...(JSON.parse(v3) as Omit<
          SavedDesign,
          keyof typeof SAVED_DESIGN_DEFAULTS
        >),
      };
    // v2 → v3: convert seam string keys → SeamLine objects
    const v2 = localStorage.getItem(LEGACY_KEY_V2);
    if (v2) {
      const d = JSON.parse(v2) as { seams?: string[] } & Omit<
        SavedDesign,
        "seams"
      >;
      return {
        ...SAVED_DESIGN_DEFAULTS,
        ...d,
        seams: (d.seams ?? [])
          .map(seamLineFromKey)
          .filter(Boolean) as SeamLine[],
      };
    }
    // v1 → v2: seam positions were whole-cell (multiply by 2), convert to SeamLine objects
    const v1 = localStorage.getItem(LEGACY_KEY_V1);
    if (v1) {
      const d = JSON.parse(v1) as { seams?: string[] } & Omit<
        SavedDesign,
        "seams"
      >;
      return {
        ...SAVED_DESIGN_DEFAULTS,
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

function saveDesign(d: SavedDesign) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

function makeEmptyCells(totalCols: number, totalRows: number): string[] {
  return Array<string>(totalCols * totalRows).fill("");
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WholeQuiltDesigner() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const urlCols = params.get("cols") ? Number(params.get("cols")) : null;
  const urlRows = params.get("rows") ? Number(params.get("rows")) : null;
  const urlBlockSize = params.get("blockSize")
    ? Number(params.get("blockSize"))
    : null;
  const urlId = params.get("id") ?? "";
  const isNewDesign = params.get("new") === "1";

  // Redirect to the list if not accessing a specific design or creating a new one
  useEffect(() => {
    if (!urlId && !isNewDesign && !urlCols && !urlRows && !urlBlockSize) {
      window.location.href = "/whole-quilt";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable design ID for this session
  const designIdRef = useRef<string>(urlId || crypto.randomUUID());
  const designId = designIdRef.current;
  const createdAtRef = useRef<string>(new Date().toISOString());

  const saved = urlId ? loadDesignById(urlId) : null;
  if (saved?.createdAt) createdAtRef.current = saved.createdAt;

  const [name, setName] = useState(saved?.name ?? "My Quilt");
  const [quiltRows, setQuiltRows] = useState(urlRows ?? saved?.quiltRows ?? 4);
  const [quiltCols, setQuiltCols] = useState(urlCols ?? saved?.quiltCols ?? 4);

  usePageAssistantContext(
    "quilting-whole-quilt-designer",
    `Whole-Quilt Designer page (${
      isNewDesign ? "new design" : `editing design "${name}"`
    }). This is a visual grid tool for laying out an entire quilt top block-by-block — it is saved locally in the browser (not synced to the server) and cannot be operated via chat. If the user wants to design or edit a whole-quilt layout here, tell them to use this page directly.`,
  );
  const [blockGridSize, setBlockGridSize] = useState<
    2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
  >(
    (urlBlockSize ?? saved?.blockGridSize ?? 4) as
      | 2
      | 3
      | 4
      | 5
      | 6
      | 7
      | 8
      | 9
      | 10
      | 11
      | 12,
  );

  const totalCols = quiltCols * blockGridSize;
  const totalRows = quiltRows * blockGridSize;

  const [cells, setCells] = useState<string[]>(() => {
    if (
      saved &&
      saved.cells.length ===
        saved.quiltRows *
          saved.blockGridSize *
          saved.quiltCols *
          saved.blockGridSize
    ) {
      return saved.cells;
    }
    return makeEmptyCells(quiltCols * blockGridSize, quiltRows * blockGridSize);
  });

  const [seams, setSeams] = useState<SeamLine[]>(() => saved?.seams ?? []);
  const [tool, setTool] = useState<WholeTool>("paint");
  const [prePanTool, setPrePanTool] = useState<WholeTool>("paint");

  const [primaryColor, setPrimaryColor] = useState(
    saved?.primaryColor ?? "#C0392B",
  );
  const [secondaryColor, setSecondaryColor] = useState(
    saved?.secondaryColor ?? "#FFFFFF",
  );
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");

  const [history, setHistory] = useState<
    { cells: string[]; seams: SeamLine[] }[]
  >([]);
  const [isDirty, setIsDirty] = useState(false);
  const [seamOnly, setSeamOnly] = useState(false);
  const [gridLineOpacity, setGridLineOpacity] = useState(35);
  const [blockLineOpacity, setBlockLineOpacity] = useState(70);

  const [lastSeamTool, setLastSeamTool] = useState<
    | "seam-h"
    | "seam-v"
    | "line-nwse"
    | "line-nesw"
    | "qline-back"
    | "qline-fwd"
    | "seam-snip"
  >("seam-h");
  const [lastTriTool, setLastTriTool] = useState<"tri-nwse" | "tri-nesw">(
    "tri-nwse",
  );

  // ── Block & quilt dimensions ──────────────────────────────────────────────
  const [blockSizeInches, setBlockSizeInches] = useState<number | null>(
    saved?.blockSizeInches ?? null,
  );
  const [seamAllowanceInches, setSeamAllowanceInches] = useState<number>(
    saved?.seamAllowanceInches ?? 0.25,
  );

  // ── Sashing / border / cornerstones ──────────────────────────────────────
  const [sashingEnabled, setSashingEnabled] = useState(
    saved?.sashingEnabled ?? false,
  );
  const [sashingWidthInches, setSashingWidthInches] = useState(
    saved?.sashingWidthInches ?? 1.5,
  );
  const [sashingColor, setSashingColor] = useState(
    saved?.sashingColor ?? DEFAULT_SASHING_COLOR,
  );
  const [borderEnabled, setBorderEnabled] = useState(
    saved?.borderEnabled ?? false,
  );
  const [borderWidthInches, setBorderWidthInches] = useState(
    saved?.borderWidthInches ?? 3,
  );
  const [borderColor, setBorderColor] = useState(
    saved?.borderColor ?? DEFAULT_BORDER_COLOR,
  );
  const [cornerstoneEnabled, setCornerstoneEnabled] = useState(
    saved?.cornerstoneEnabled ?? false,
  );
  const [cornerstoneColor, setCornerstoneColor] = useState(
    saved?.cornerstoneColor ?? DEFAULT_CORNERSTONE_COLOR,
  );

  const [showExtractDialog, setShowExtractDialog] = useState(false);
  const [extractPrefix, setExtractPrefix] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const pendingNavRef = useRef<string | null>(null);

  // Panel state — same draggable pattern as Block Designer
  type PanelId = "colours" | "layout" | "shortcuts" | "fabrics";
  interface PanelWin {
    id: PanelId;
    title: string;
    open: boolean;
    minimized: boolean;
  }
  const [panels, setPanels] = useState<PanelWin[]>([
    { id: "colours", title: "Colours", open: true, minimized: false },
    { id: "fabrics", title: "Fabrics", open: true, minimized: false },
    { id: "layout", title: "Layout", open: true, minimized: false },
    { id: "shortcuts", title: "Shortcuts", open: false, minimized: false },
  ]);
  const [dragPanelId, setDragPanelId] = useState<PanelId | null>(null);
  const [dragOverId, setDragOverId] = useState<PanelId | null>(null);

  const { data: fabricsData } = useListFabrics({ pageSize: 200 });
  const fabricsList = fabricsData?.items;
  const fabricUrlMap = useMemo(
    () => buildFabricUrlMap(fabricsList ?? []),
    [fabricsList],
  );
  const fabricTally = useMemo(
    () => computeFabricTally(cells, fabricsList ?? []),
    [cells, fabricsList],
  );

  function togglePanel(id: PanelId, key: "open" | "minimized") {
    setPanels((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [key]: !p[key] } : p)),
    );
  }

  // ── Auto-sizing canvas ────────────────────────────────────────────────────

  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [canvasCellPx, setCanvasCellPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    function measure() {
      const W = el!.clientWidth - 24 - RULER_THICK;
      const H = el!.clientHeight - 24 - RULER_THICK;
      if (W <= 0 || H <= 0) return;
      const byW = Math.floor(W / totalCols);
      const byH = Math.floor(H / totalRows);
      const px = Math.max(4, Math.min(56, Math.min(byW, byH)));
      setCanvasCellPx(px);
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [totalCols, totalRows]);

  const dynCellPx =
    canvasCellPx ??
    Math.min(Math.floor(400 / Math.max(totalCols, totalRows)), 56);

  // ── Resize cells array when quilt dimensions change ───────────────────────

  useEffect(() => {
    const needed = totalCols * totalRows;
    setCells((prev) => {
      if (prev.length === needed) return prev;
      if (prev.length > needed) return prev.slice(0, needed);
      return [...prev, ...Array<string>(needed - prev.length).fill("")];
    });
  }, [totalCols, totalRows]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedColor = activeSlot === "a" ? primaryColor : secondaryColor;
  const selectedColorB = activeSlot === "a" ? secondaryColor : primaryColor;

  // Finished quilt size (includes sashing + border when blockSizeInches is set)
  const sashW = sashingEnabled ? sashingWidthInches : 0;
  const borderW = borderEnabled ? borderWidthInches : 0;
  const quiltFinishedW =
    blockSizeInches !== null
      ? quiltCols * blockSizeInches + sashW * (quiltCols - 1) + borderW * 2
      : null;
  const quiltFinishedH =
    blockSizeInches !== null
      ? quiltRows * blockSizeInches + sashW * (quiltRows - 1) + borderW * 2
      : null;
  // Cutting size per block = finished block size + 2× seam allowance
  const cuttingSize =
    blockSizeInches !== null ? blockSizeInches + 2 * seamAllowanceInches : null;

  const SEAM_TOOLS = [
    "seam-h",
    "seam-v",
    "line-nwse",
    "line-nesw",
    "qline-back",
    "qline-fwd",
    "seam-snip",
  ] as const;
  const TRI_TOOLS = ["tri-nwse", "tri-nesw"] as const;
  const isSeamActive = (SEAM_TOOLS as readonly WholeTool[]).includes(tool);
  const isTriActive = (TRI_TOOLS as readonly WholeTool[]).includes(tool);
  const seamDisplay = isSeamActive
    ? (tool as typeof lastSeamTool)
    : lastSeamTool;
  const triDisplay = isTriActive ? (tool as typeof lastTriTool) : lastTriTool;

  const SEAM_ICONS: Record<typeof lastSeamTool, React.ReactNode> = {
    "seam-h": (
      <span className="text-sm font-bold leading-none select-none">─</span>
    ),
    "seam-v": (
      <span className="text-sm font-bold leading-none select-none">│</span>
    ),
    "line-nwse": (
      <span className="text-sm font-bold leading-none select-none">╲</span>
    ),
    "line-nesw": (
      <span className="text-sm font-bold leading-none select-none">╱</span>
    ),
    "qline-back": (
      <span className="text-sm font-bold leading-none select-none">◹</span>
    ),
    "qline-fwd": (
      <span className="text-sm font-bold leading-none select-none">◸</span>
    ),
    "seam-snip": <Scissors className="h-4 w-4" />,
  };
  const TRI_ICONS: Record<typeof lastTriTool, React.ReactNode> = {
    "tri-nwse": <span className="text-base leading-none select-none">◪</span>,
    "tri-nesw": <span className="text-base leading-none select-none">◩</span>,
  };

  // ── History helpers ───────────────────────────────────────────────────────

  function pushHistory(snap: string[], snapSeams: SeamLine[]) {
    setHistory((prev) => [
      ...prev.slice(-40),
      { cells: snap, seams: snapSeams },
    ]);
  }

  function handleUndo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const snap = h[h.length - 1];
      setCells(snap.cells);
      setSeams(snap.seams);
      return h.slice(0, -1);
    });
    setIsDirty(true);
  }

  // ── Cell action ──────────────────────────────────────────────────────────
  // BlockGrid calls this for every cell-level interaction (paint, erase, fill,
  // eyedropper, triangle, diagonal seam tools). Seam-h/v, seam-snip, and pan
  // are handled by BlockGrid itself via the dedicated callbacks below.

  function handleCellAction(
    idx: number,
    cellX: number,
    cellY: number,
    cellPx: number,
  ) {
    const col = idx % totalCols;
    const row = Math.floor(idx / totalCols);

    if (tool === "eyedropper") {
      setCells((prev) => {
        const p = parseCell(prev[idx] ?? "");
        let color: string | null = null;
        if (p.kind === "solid") color = p.color || null;
        else if (p.kind === "triangle") {
          const isA =
            p.type === "nwse" ? cellX < cellPx / 2 : cellX >= cellPx / 2;
          color = (isA ? p.a : p.b) || null;
        } else if (p.kind === "hsplit")
          color = (cellY < cellPx / 2 ? p.top : p.bottom) || null;
        else if (p.kind === "vsplit")
          color = (cellX < cellPx / 2 ? p.left : p.right) || null;
        if (color) {
          if (activeSlot === "a") setPrimaryColor(color);
          else setSecondaryColor(color);
        }
        setTool("paint");
        return prev;
      });
      return;
    }

    setCells((prev) => {
      const current = prev[idx] ?? "";

      if (tool === "fill") {
        pushHistory(prev, seams);
        return seamFill(
          prev,
          totalCols,
          totalRows,
          col + cellX / cellPx,
          row + cellY / cellPx,
          selectedColor,
          seams,
        );
      }

      if (tool === "erase") {
        if (current === "") return prev;
        pushHistory(prev, seams);
        const nx = [...prev];
        nx[idx] = "";
        return nx;
      }

      if (tool === "paint") {
        if (current === selectedColor) return prev;
        pushHistory(prev, seams);
        const nx = [...prev];
        nx[idx] = selectedColor;
        return nx;
      }

      if (tool === "tri-nwse" || tool === "tri-nesw") {
        const newCell = `${tool === "tri-nwse" ? "nwse" : "nesw"}:${selectedColor}:${selectedColorB}`;
        if (current === newCell) return prev;
        pushHistory(prev, seams);
        const nx = [...prev];
        nx[idx] = newCell;
        return nx;
      }

      if (tool === "line-nwse" || tool === "line-nesw") {
        const mineType =
          tool === "line-nwse" ? ("nwse" as const) : ("nesw" as const);
        const parsed = parseCell(current);
        let nwseCs = 1,
          nwseCe = 0,
          neswCs = 1,
          neswCe = 0;
        if (parsed.kind === "xline") {
          nwseCs = parsed.nwseCs;
          nwseCe = parsed.nwseCe;
          neswCs = parsed.neswCs;
          neswCe = parsed.neswCe;
        } else if (parsed.kind === "line") {
          if (parsed.type === "nwse") {
            nwseCs = parsed.cs;
            nwseCe = parsed.ce;
          } else {
            neswCs = parsed.cs;
            neswCe = parsed.ce;
          }
        }
        const present =
          mineType === "nwse"
            ? nwseCe > nwseCs + 0.001
            : neswCe > neswCs + 0.001;
        const newCs = present ? 1 : 0,
          newCe = present ? 0 : 1;
        const newVal = encodeXline(
          mineType === "nwse" ? newCs : nwseCs,
          mineType === "nwse" ? newCe : nwseCe,
          mineType === "nesw" ? newCs : neswCs,
          mineType === "nesw" ? newCe : neswCe,
        );
        if (current === newVal) return prev;
        pushHistory(prev, seams);
        const nx = [...prev];
        nx[idx] = newVal;
        return nx;
      }

      if (tool === "qline-back" || tool === "qline-fwd") {
        const pair =
          tool === "qline-back" ? ("back" as const) : ("fwd" as const);
        const dir = quarterDirForClick(pair, cellX / cellPx, cellY / cellPx);
        pushHistory(prev, seams);
        return toggleQuarterLine(prev, idx, dir);
      }

      return prev;
    });

    setIsDirty(true);
  }

  // ── Seam handlers ─────────────────────────────────────────────────────────

  function handleSeamToggle(axis: "h" | "v", pos: number, cellIdx: number) {
    pushHistory(cells, seams);
    setSeams((prev) => {
      const exists = prev.some(
        (s) => s.axis === axis && s.pos === pos && s.cellIdx === cellIdx,
      );
      return exists
        ? prev.filter(
            (s) => !(s.axis === axis && s.pos === pos && s.cellIdx === cellIdx),
          )
        : [...prev, { axis, pos, cellIdx }];
    });
    setIsDirty(true);
  }

  function handleSeamSnip(
    idx: number,
    clipStart: number,
    clipEnd: number,
    tailIndices: number[] = [],
  ) {
    pushHistory(cells, seams);
    const deleteSet = new Set<number>(tailIndices);
    if (clipStart >= clipEnd - 0.001) deleteSet.add(idx);
    setSeams((prev) =>
      prev
        .map((s, i) =>
          i === idx && clipStart < clipEnd - 0.001
            ? { ...s, clipStart, clipEnd }
            : s,
        )
        .filter((_, i) => !deleteSet.has(i)),
    );
    setIsDirty(true);
  }

  function handleDiagSnip(
    idx: number,
    diagType: "nwse" | "nesw",
    removeStart: number,
    removeEnd: number,
  ) {
    pushHistory(cells, seams);
    setCells((prev) => {
      const next = [...prev];
      const p = parseCell(next[idx] ?? "");
      let cs = 0,
        ce = 1;
      if (p.kind === "line") {
        cs = p.cs;
        ce = p.ce;
      } else if (p.kind === "xline") {
        if (diagType === "nwse") {
          cs = p.nwseCs;
          ce = p.nwseCe;
        } else {
          cs = p.neswCs;
          ce = p.neswCe;
        }
      }
      const keepCs = Math.abs(removeStart - cs) < 0.001 ? removeEnd : cs;
      const keepCe = Math.abs(removeEnd - ce) < 0.001 ? removeStart : ce;
      next[idx] = applyDiagClip(p, diagType, keepCs, keepCe);
      return next;
    });
    setIsDirty(true);
  }

  // ── Auto-seam ─────────────────────────────────────────────────────────────

  const handleAutoSeam = useCallback(
    (mode: "grid" | "contiguous") => {
      const newSeams: SeamLine[] = [];
      if (mode === "grid") {
        for (let row = 1; row < totalRows; row++)
          for (let col = 0; col < totalCols; col++)
            newSeams.push({ axis: "h", pos: 2 * row, cellIdx: col });
        for (let col = 1; col < totalCols; col++)
          for (let row = 0; row < totalRows; row++)
            newSeams.push({ axis: "v", pos: 2 * col, cellIdx: row });
      } else {
        for (let row = 0; row < totalRows - 1; row++)
          for (let col = 0; col < totalCols; col++)
            if (
              (cells[row * totalCols + col] ?? "") !==
              (cells[(row + 1) * totalCols + col] ?? "")
            )
              newSeams.push({ axis: "h", pos: 2 * (row + 1), cellIdx: col });
        for (let row = 0; row < totalRows; row++)
          for (let col = 0; col < totalCols - 1; col++)
            if (
              (cells[row * totalCols + col] ?? "") !==
              (cells[row * totalCols + col + 1] ?? "")
            )
              newSeams.push({ axis: "v", pos: 2 * (col + 1), cellIdx: row });
      }
      setSeams((prev) => {
        pushHistory(cells, prev);
        const existing = new Set(
          prev.map((s) => `${s.axis}:${s.pos}:${s.cellIdx}`),
        );
        return [
          ...prev,
          ...newSeams.filter(
            (s) => !existing.has(`${s.axis}:${s.pos}:${s.cellIdx}`),
          ),
        ];
      });
      setIsDirty(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [totalCols, totalRows, cells],
  );

  // ── Clear ─────────────────────────────────────────────────────────────────

  function handleClear() {
    if (!confirm("Clear all cells?")) return;
    pushHistory(cells, seams);
    setCells(makeEmptyCells(totalCols, totalRows));
    setSeams([]);
    setIsDirty(true);
  }

  // ── Save / Discard ────────────────────────────────────────────────────────

  function handleSave() {
    const now = new Date().toISOString();
    upsertDesign({
      id: designId,
      name,
      quiltRows,
      quiltCols,
      blockGridSize,
      cells,
      seams,
      primaryColor,
      secondaryColor,
      blockSizeInches,
      seamAllowanceInches,
      sashingEnabled,
      sashingWidthInches,
      sashingColor,
      borderEnabled,
      borderWidthInches,
      borderColor,
      cornerstoneEnabled,
      cornerstoneColor,
      createdAt: createdAtRef.current,
      updatedAt: now,
    } satisfies WholequiltDesign);
    setIsDirty(false);
    toast.success("Quilt design saved");
  }

  function handleDiscard() {
    const last = loadDesignById(designId);
    if (last) {
      setName(last.name);
      setQuiltRows(last.quiltRows);
      setQuiltCols(last.quiltCols);
      setBlockGridSize(last.blockGridSize as typeof blockGridSize);
      setCells(last.cells);
      setSeams(last.seams ?? []);
      setPrimaryColor(last.primaryColor);
      setSecondaryColor(last.secondaryColor);
      setBlockSizeInches(last.blockSizeInches);
      setSeamAllowanceInches(last.seamAllowanceInches);
      setSashingEnabled(last.sashingEnabled);
      setSashingWidthInches(last.sashingWidthInches);
      setSashingColor(last.sashingColor);
      setBorderEnabled(last.borderEnabled);
      setBorderWidthInches(last.borderWidthInches);
      setBorderColor(last.borderColor);
      setCornerstoneEnabled(last.cornerstoneEnabled);
      setCornerstoneColor(last.cornerstoneColor);
    } else {
      setCells(makeEmptyCells(totalCols, totalRows));
      setSeams([]);
    }
    setIsDirty(false);
    setHistory([]);
  }

  function requestNav(to: string) {
    if (isDirty) {
      pendingNavRef.current = to;
      setShowExitDialog(true);
    } else navigate(to);
  }
  useRegisterNavGuard(requestNav);

  // ── Export ────────────────────────────────────────────────────────────────

  async function handleExport(format: "png" | "jpeg" | "gif") {
    const svgEl = document.querySelector<SVGSVGElement>("[data-grid-export]");
    if (!svgEl) {
      toast.error("Could not find the canvas to export.");
      return;
    }
    const serializer = new XMLSerializer();
    let svgStr = serializer.serializeToString(svgEl);
    if (!svgStr.includes("xmlns="))
      svgStr = svgStr.replace(
        "<svg",
        '<svg xmlns="http://www.w3.org/2000/svg"',
      );
    const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = svgUrl;
    });
    URL.revokeObjectURL(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const mime =
      format === "jpeg"
        ? "image/jpeg"
        : format === "gif"
          ? "image/gif"
          : "image/png";
    canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `${(name.trim() || "quilt").replace(/\s+/g, "-").toLowerCase()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, mime);
  }

  // ── Extract blocks ────────────────────────────────────────────────────────

  const createBlock = useCreateBlock();

  async function handleExtract() {
    setExtracting(true);
    const prefix = (extractPrefix.trim() || name.trim() || "Quilt") + " —";
    let ok = 0,
      fail = 0;
    for (let br = 0; br < quiltRows; br++) {
      for (let bc = 0; bc < quiltCols; bc++) {
        const blockCells: string[] = [];
        for (let ci = 0; ci < blockGridSize; ci++) {
          for (let cj = 0; cj < blockGridSize; cj++) {
            const row = br * blockGridSize + ci;
            const col = bc * blockGridSize + cj;
            blockCells.push(cells[row * totalCols + col] ?? "");
          }
        }
        const blockName = `${prefix} Block (${br + 1},${bc + 1})`;
        try {
          await createBlock.mutateAsync({
            data: {
              name: blockName,
              gridSize: blockGridSize,
              cells: blockCells,
            },
          });
          ok++;
        } catch {
          fail++;
        }
      }
    }
    setExtracting(false);
    setShowExtractDialog(false);
    if (fail === 0) toast.success(`Extracted ${ok} blocks to Block Designer.`);
    else toast.error(`${ok} saved, ${fail} failed — check your connection.`);
  }

  // ── Tool select ───────────────────────────────────────────────────────────

  function selectTool(t: WholeTool) {
    setTool(t);
    if ((SEAM_TOOLS as readonly string[]).includes(t))
      setLastSeamTool(t as typeof lastSeamTool);
    if ((TRI_TOOLS as readonly string[]).includes(t))
      setLastTriTool(t as typeof lastTriTool);
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if ((e.key === "z" || e.key === "Z") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSave();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (tool !== "pan") {
          setPrePanTool(tool);
          setTool("pan");
        }
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space")
        setTool((prev) => (prev === "pan" ? prePanTool : prev));
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, prePanTool]);

  // ── Tool hint ─────────────────────────────────────────────────────────────

  const toolHint: string = (() => {
    if (tool === "paint")
      return "🖌 Paint — click or drag to fill cells with the selected colour.";
    if (tool === "fill")
      return "🪣 Fill — flood-fill connected same-colour cells.";
    if (tool === "erase") return "⬜ Erase — click or drag to clear cells.";
    if (tool === "eyedropper")
      return "💉 Eyedropper — click a cell to pick its colour.";
    if (tool === "pan")
      return "✋ Pan — drag to scroll. Release Space to return to previous tool.";
    if (tool === "tri-nwse" || tool === "tri-nesw")
      return `△ Half-cell — primary (${primaryColor}) / secondary (${secondaryColor}) triangles.`;
    if (tool === "line-nwse")
      return "╲ Diagonal seam — click a cell to draw the \\ seam line. Click again to remove.";
    if (tool === "line-nesw")
      return "╱ Diagonal seam — click a cell to draw the / seam line. Click again to remove.";
    if (tool === "qline-back")
      return "◹ Quarter seam ╲ — click NE or SW corner of a cell. Click again to remove.";
    if (tool === "qline-fwd")
      return "◸ Quarter seam ╱ — click NW or SE corner of a cell. Click again to remove.";
    if (tool === "seam-h")
      return "─ H seam — click a grid edge for a between-cell seam, or cell centre to split horizontally.";
    if (tool === "seam-v")
      return "│ V seam — click a grid edge for a between-cell seam, or cell centre to split vertically.";
    if (tool === "seam-snip")
      return "✂ Trim — hover over a seam or diagonal; it turns red. Click to remove it.";
    return "Select a tool to start drawing.";
  })();

  // ── UI helpers ────────────────────────────────────────────────────────────

  const menuBtnCls =
    "rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors";

  function TB({
    id,
    icon,
    label,
  }: {
    id: WholeTool;
    icon: React.ReactNode;
    label: string;
  }) {
    return (
      <button
        onClick={() => selectTool(id)}
        title={label}
        className={`flex h-9 w-9 items-center justify-center rounded transition-colors ${
          tool === id
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        {icon}
      </button>
    );
  }

  function TBAction({
    icon,
    label,
    onClick,
    active = false,
    disabled = false,
  }: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
  }) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        title={label}
        className={`flex h-9 w-9 items-center justify-center rounded transition-colors ${
          active
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
        }`}
      >
        {icon}
      </button>
    );
  }

  function TSep() {
    return <div className="my-1 h-px w-7 self-center bg-border" />;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* ── Unsaved-changes exit dialog ── */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this quilt design. What would you like
              to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setShowExitDialog(false);
                setIsDirty(false);
                navigate(pendingNavRef.current ?? "/whole-quilt");
              }}
            >
              Discard &amp; exit
            </Button>
            <AlertDialogAction
              onClick={() => {
                setShowExitDialog(false);
                handleSave();
                navigate(pendingNavRef.current ?? "/whole-quilt");
              }}
            >
              Save &amp; exit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Extract dialog ── */}
      <Dialog open={showExtractDialog} onOpenChange={setShowExtractDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extract blocks to Block Designer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will create {quiltRows * quiltCols} new block records — one
              per block in your {quiltCols}×{quiltRows} grid. Each block will be{" "}
              {blockGridSize}×{blockGridSize} cells.
            </p>
            <div className="space-y-1.5">
              <Label className="text-sm">Block name prefix</Label>
              <Input
                value={extractPrefix}
                onChange={(e) => setExtractPrefix(e.target.value)}
                placeholder={name.trim() || "My Quilt"}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Blocks will be named: &quot;
                {extractPrefix.trim() || name.trim() || "Quilt"} — Block
                (row,col)&quot;
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowExtractDialog(false)}
              disabled={extracting}
            >
              Cancel
            </Button>
            <Button onClick={handleExtract} disabled={extracting}>
              {extracting
                ? "Extracting…"
                : `Extract ${quiltRows * quiltCols} blocks`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Title bar ──────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-background px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => requestNav("/whole-quilt")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setIsDirty(true);
          }}
          className="h-8 max-w-[220px] text-sm font-semibold"
          placeholder="Quilt name…"
        />
        <span className="text-xs text-muted-foreground">
          {quiltCols}×{quiltRows} blocks · {totalCols}×{totalRows} cells
          {quiltFinishedW !== null && quiltFinishedH !== null && (
            <>
              {" "}
              ·{" "}
              <span className="font-medium text-foreground">
                {fmtInch(quiltFinishedW)}" × {fmtInch(quiltFinishedH)}"
              </span>{" "}
              finished
            </>
          )}
        </span>
        {isDirty && (
          <span
            className="h-2 w-2 rounded-full bg-amber-500"
            title="Unsaved changes"
          />
        )}
        <Button onClick={handleSave} size="sm" className="ml-auto h-8">
          <Save className="mr-1.5 h-3.5 w-3.5" />
          Save
        </Button>
      </div>

      {/* ── Menu bar ───────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center border-b bg-muted/20 px-1 py-0.5">
        {/* File */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>File</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={handleSave}>
              <Save className="mr-2 h-3.5 w-3.5" /> Save (⌘S)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDiscard} disabled={!isDirty}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" /> Revert to saved
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setExtractPrefix(name.trim());
                setShowExtractDialog(true);
              }}
            >
              <FilePlus2 className="mr-2 h-3.5 w-3.5" /> Extract blocks…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Download className="mr-2 h-3.5 w-3.5" /> Export image
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => handleExport("png")}>
                  PNG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("jpeg")}>
                  JPEG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("gif")}>
                  GIF
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Edit */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>Edit</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuItem
              onClick={handleUndo}
              disabled={history.length === 0}
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" /> Undo (Z)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleClear}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Clear canvas
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={seams.length === 0}
              onClick={() => {
                pushHistory(cells, seams);
                setSeams([]);
                setIsDirty(true);
              }}
              className="text-destructive focus:text-destructive disabled:pointer-events-none disabled:opacity-50"
            >
              Clear all seams
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Grid */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>Grid</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs">
              Block size (cells per block)
            </DropdownMenuLabel>
            {([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const).map((n) => (
              <DropdownMenuCheckboxItem
                key={n}
                checked={blockGridSize === n}
                onCheckedChange={() => {
                  setBlockGridSize(n);
                  setIsDirty(true);
                }}
              >
                {n}×{n}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <div
              className="px-2 py-2"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Grid lines
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {gridLineOpacity}%
                </span>
              </div>
              <Slider
                min={0}
                max={100}
                step={5}
                value={[gridLineOpacity]}
                onValueChange={([v]) => setGridLineOpacity(v)}
                className="w-full"
              />
              <div className="mb-1.5 mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Block boundary lines
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {blockLineOpacity}%
                </span>
              </div>
              <Slider
                min={0}
                max={100}
                step={5}
                value={[blockLineOpacity]}
                onValueChange={([v]) => setBlockLineOpacity(v)}
                className="w-full"
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Seams */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>Seams</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel className="text-xs">
              Place seam
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => selectTool("seam-h")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                ─
              </span>
              Horizontal
              {tool === "seam-h" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => selectTool("seam-v")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                │
              </span>
              Vertical
              {tool === "seam-v" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => selectTool("line-nwse")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                ╲
              </span>
              Diagonal NW→SE
              {tool === "line-nwse" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => selectTool("line-nesw")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                ╱
              </span>
              Diagonal NE→SW
              {tool === "line-nesw" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">
              Quarter seams
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => selectTool("qline-back")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                ◹
              </span>
              Quarter ╲ (NE / SW)
              {tool === "qline-back" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => selectTool("qline-fwd")}>
              <span className="mr-2 w-4 text-center text-sm font-bold leading-none">
                ◸
              </span>
              Quarter ╱ (NW / SE)
              {tool === "qline-fwd" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => selectTool("seam-snip")}>
              <Scissors className="mr-2 h-3.5 w-3.5" />
              Trim at crossing
              {tool === "seam-snip" && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Auto-Seam</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => handleAutoSeam("grid")}>
                  Every row &amp; column
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAutoSeam("contiguous")}>
                  Same-colour outlines
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={seams.length === 0}
              onClick={() => {
                pushHistory(cells, seams);
                setSeams([]);
                setIsDirty(true);
              }}
              className="text-destructive focus:text-destructive disabled:pointer-events-none disabled:opacity-50"
            >
              Clear all seams
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* View */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>View</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuCheckboxItem
              checked={seamOnly}
              onCheckedChange={() => setSeamOnly((v) => !v)}
            >
              Seams only
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Windows */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={menuBtnCls}>Windows</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel className="text-xs">
              Right panel
            </DropdownMenuLabel>
            {panels.map((p) => (
              <DropdownMenuCheckboxItem
                key={p.id}
                checked={p.open}
                onCheckedChange={() => togglePanel(p.id, "open")}
              >
                {p.title}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Quick controls sub-bar ──────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-background px-2 py-1 text-xs">
        {/* Block grid size */}
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-muted-foreground">Block</span>
          <Select
            value={String(blockGridSize)}
            onValueChange={(v) => {
              setBlockGridSize(Number(v) as typeof blockGridSize);
              setIsDirty(true);
            }}
          >
            <SelectTrigger className="h-6 w-20 px-1.5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const).map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  {n}×{n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">cells</span>
        </div>

        <span className="text-muted-foreground/40">|</span>

        {/* Quilt size */}
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-muted-foreground">Quilt</span>
          <input
            type="number"
            min={1}
            max={20}
            value={quiltCols}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n >= 1 && n <= 20) {
                setQuiltCols(n);
                setIsDirty(true);
              }
            }}
            className="h-6 w-12 rounded border border-input bg-background px-1 text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            title="Quilt columns"
          />
          <span className="text-muted-foreground">×</span>
          <input
            type="number"
            min={1}
            max={20}
            value={quiltRows}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n >= 1 && n <= 20) {
                setQuiltRows(n);
                setIsDirty(true);
              }
            }}
            className="h-6 w-12 rounded border border-input bg-background px-1 text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            title="Quilt rows"
          />
          <span className="text-muted-foreground">blocks</span>
        </div>

        <span className="text-muted-foreground/40">|</span>

        {/* Finished block size */}
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-muted-foreground">
            Finished size
          </span>
          <input
            type="number"
            min={1}
            max={120}
            step={0.5}
            value={blockSizeInches ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setBlockSizeInches(
                v === "" ? null : Math.max(1, Math.min(120, Number(v))),
              );
              setIsDirty(true);
            }}
            className="h-6 w-14 rounded border border-input bg-background px-1 text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="in"
            title="Finished block size in inches"
          />
          <span className="text-muted-foreground">in/block</span>
        </div>

        <span className="text-muted-foreground/40">|</span>

        {/* Seam allowance */}
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-muted-foreground">Seam allow.</span>
          <Select
            value={String(seamAllowanceInches)}
            onValueChange={(v) => {
              setSeamAllowanceInches(Number(v));
              setIsDirty(true);
            }}
          >
            <SelectTrigger className="h-6 w-24 px-1.5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.125">⅛ in</SelectItem>
              <SelectItem value="0.25">¼ in (std)</SelectItem>
              <SelectItem value="0.375">⅜ in</SelectItem>
              <SelectItem value="0.5">½ in</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Finished quilt size pill — only when blockSizeInches is set */}
        {quiltFinishedW !== null && quiltFinishedH !== null && (
          <>
            <span className="text-muted-foreground/40">|</span>
            <div className="flex items-center gap-1.5 rounded border border-border bg-muted/20 px-2 py-0.5">
              <span className="font-medium text-foreground">
                {fmtInch(quiltFinishedW)}" × {fmtInch(quiltFinishedH)}"
              </span>
              <span className="text-muted-foreground">finished</span>
              {cuttingSize !== null && (
                <span className="text-muted-foreground">
                  · cut {fmtInch(cuttingSize)}" blocks
                </span>
              )}
            </div>
          </>
        )}

        <span className="text-muted-foreground/40">|</span>

        {/* Grid line opacity */}
        <div className="flex w-28 items-center gap-2">
          <span className="font-medium text-muted-foreground">Lines</span>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[gridLineOpacity]}
            onValueChange={([v]) => setGridLineOpacity(v)}
            className="flex-1"
          />
          <span className="w-7 text-right tabular-nums text-muted-foreground">
            {gridLineOpacity}%
          </span>
        </div>

        <span className="text-muted-foreground/40">|</span>

        {/* Block line opacity */}
        <div className="flex w-32 items-center gap-2">
          <span className="font-medium text-muted-foreground">Blocks</span>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[blockLineOpacity]}
            onValueChange={([v]) => setBlockLineOpacity(v)}
            className="flex-1"
          />
          <span className="w-7 text-right tabular-nums text-muted-foreground">
            {blockLineOpacity}%
          </span>
        </div>

        <span className="text-muted-foreground/40">|</span>

        {/* Seams-only toggle */}
        <button
          onClick={() => setSeamOnly((v) => !v)}
          className={`flex items-center gap-1.5 rounded px-2 py-1 transition-colors ${
            seamOnly
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          }`}
          title="Toggle seams-only view"
        >
          {seamOnly ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          Seams only
        </button>
      </div>

      {/* ── Workspace ─────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left toolbar */}
        <div className="flex w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r bg-muted/10 py-2">
          <TBAction
            icon={<RotateCcw className="h-4 w-4" />}
            label="Undo (Z)"
            onClick={handleUndo}
            disabled={history.length === 0}
          />
          <TBAction
            icon={<Save className="h-4 w-4" />}
            label="Save (⌘S)"
            onClick={handleSave}
          />
          <TBAction
            icon={<Trash2 className="h-4 w-4" />}
            label="Clear canvas"
            onClick={handleClear}
          />
          <TSep />
          <TB
            id="paint"
            icon={<Paintbrush className="h-4 w-4" />}
            label="Paint"
          />
          <TB
            id="fill"
            icon={<PaintBucket className="h-4 w-4" />}
            label="Fill"
          />
          <TB id="erase" icon={<Eraser className="h-4 w-4" />} label="Erase" />
          <TSep />
          <TB
            id="eyedropper"
            icon={<Pipette className="h-4 w-4" />}
            label="Sample colour"
          />
          <TSep />
          <TB
            id="pan"
            icon={<Hand className="h-4 w-4" />}
            label="Pan (Space)"
          />
          <TSep />

          {/* Seam flyout */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="Seam tools"
                className={`relative flex h-9 w-9 items-center justify-center rounded transition-colors ${
                  isSeamActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {SEAM_ICONS[seamDisplay]}
                <svg
                  className="pointer-events-none absolute bottom-0 right-0 h-2 w-2 opacity-70"
                  viewBox="0 0 6 6"
                  fill="currentColor"
                >
                  <polygon points="6,0 6,6 0,6" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" sideOffset={6} className="w-44">
              <DropdownMenuLabel className="text-xs">
                Seam tools
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => selectTool("seam-h")}>
                <span className="mr-2 w-4 text-center font-bold">─</span>{" "}
                Horizontal
                {tool === "seam-h" && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => selectTool("seam-v")}>
                <span className="mr-2 w-4 text-center font-bold">│</span>{" "}
                Vertical
                {tool === "seam-v" && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => selectTool("line-nwse")}>
                <span className="mr-2 w-4 text-center font-bold">╲</span> Diag
                NW→SE
                {tool === "line-nwse" && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => selectTool("line-nesw")}>
                <span className="mr-2 w-4 text-center font-bold">╱</span> Diag
                NE→SW
                {tool === "line-nesw" && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => selectTool("qline-back")}>
                <span className="mr-2 w-4 text-center font-bold">◹</span>{" "}
                Quarter ╲ (NE/SW)
                {tool === "qline-back" && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => selectTool("qline-fwd")}>
                <span className="mr-2 w-4 text-center font-bold">◸</span>{" "}
                Quarter ╱ (NW/SE)
                {tool === "qline-fwd" && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => selectTool("seam-snip")}>
                <Scissors className="mr-2 h-3.5 w-3.5" /> Trim at crossing
                {tool === "seam-snip" && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Triangle flyout */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="Triangle tools"
                className={`relative flex h-9 w-9 items-center justify-center rounded transition-colors ${
                  isTriActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {TRI_ICONS[triDisplay]}
                <svg
                  className="pointer-events-none absolute bottom-0 right-0 h-2 w-2 opacity-70"
                  viewBox="0 0 6 6"
                  fill="currentColor"
                >
                  <polygon points="6,0 6,6 0,6" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" sideOffset={6} className="w-44">
              <DropdownMenuLabel className="text-xs">
                Triangle tools
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => selectTool("tri-nwse")}>
                <span className="mr-2 text-base leading-none">◪</span> NW→SE
                half
                {tool === "tri-nwse" && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => selectTool("tri-nesw")}>
                <span className="mr-2 text-base leading-none">◩</span> NE→SW
                half
                {tool === "tri-nesw" && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Auto-seam flyout */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="Auto-Seam"
                className="relative flex h-9 w-9 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Wand2 className="h-4 w-4" />
                <svg
                  className="pointer-events-none absolute bottom-0 right-0 h-2 w-2 opacity-70"
                  viewBox="0 0 6 6"
                  fill="currentColor"
                >
                  <polygon points="6,0 6,6 0,6" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" sideOffset={6} className="w-52">
              <DropdownMenuLabel className="text-xs">
                Auto-Seam
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleAutoSeam("grid")}>
                <span className="mr-2 w-4 text-center text-sm leading-none">
                  #
                </span>{" "}
                Every row &amp; column
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAutoSeam("contiguous")}>
                <span className="mr-2 w-4 text-center text-sm leading-none">
                  ⬛
                </span>{" "}
                Contiguous regions
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <TSep />

          <TBAction
            icon={
              seamOnly ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )
            }
            label={seamOnly ? "Show colours" : "Seams only"}
            onClick={() => setSeamOnly((v) => !v)}
            active={seamOnly}
          />

          <TSep />

          {/* Export flyout */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="Export"
                className="relative flex h-9 w-9 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Download className="h-4 w-4" />
                <svg
                  className="pointer-events-none absolute bottom-0 right-0 h-2 w-2 opacity-70"
                  viewBox="0 0 6 6"
                  fill="currentColor"
                >
                  <polygon points="6,0 6,6 0,6" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" sideOffset={6} className="w-36">
              <DropdownMenuLabel className="text-xs">
                Export as
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleExport("png")}>
                PNG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("jpeg")}>
                JPEG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("gif")}>
                GIF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Dual colour slots */}
          <div className="mt-auto pt-1 px-1 flex flex-col gap-1">
            {(["a", "b"] as const).map((slot) => {
              const isActive = activeSlot === slot;
              const color = slot === "a" ? primaryColor : secondaryColor;
              const setColor =
                slot === "a" ? setPrimaryColor : setSecondaryColor;
              const label = slot === "a" ? "L/T" : "R/B";
              return (
                <div key={slot} className="flex items-center gap-1">
                  <button
                    title={`${label} colour — click to make active`}
                    onClick={() => setActiveSlot(slot)}
                    className={`relative h-7 w-7 shrink-0 rounded border-2 transition-all ${isActive ? "border-primary shadow-sm scale-110" : "border-muted-foreground/30"}`}
                    style={
                      color
                        ? { backgroundColor: color }
                        : {
                            background:
                              "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0 / 8px 8px",
                          }
                    }
                  />
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={`text-[8px] font-bold leading-none ${isActive ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {label}
                    </span>
                    <button
                      title="Set transparent (no colour)"
                      onClick={() => {
                        setColor("");
                        setActiveSlot(slot);
                      }}
                      className="text-[7px] leading-none text-muted-foreground hover:text-foreground"
                    >
                      ∅
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Canvas area ──────────────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden bg-muted/5">
          {/* Hint bar */}
          <div className="shrink-0 px-4 pt-3 pb-1">
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-800">
              {toolHint}
            </div>
          </div>
          {/* Grid measurement zone — fills remaining height, centres ruler+grid */}
          <div
            ref={canvasAreaRef}
            className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3"
          >
            <div className="flex flex-col" style={{ gap: 0 }}>
              {/* Top: corner spacer + horizontal ruler */}
              <div className="flex">
                <div
                  style={{ width: RULER_THICK, height: RULER_THICK }}
                  className="shrink-0 rounded-tl-sm border-b border-r border-border/40 bg-muted/50"
                />
                <BlockRuler
                  orientation="h"
                  count={totalCols}
                  cellPx={dynCellPx}
                  blockSizeInches={
                    blockSizeInches !== null
                      ? blockSizeInches * quiltCols
                      : null
                  }
                />
              </div>
              {/* Bottom: vertical ruler + grid */}
              <div className="flex">
                <BlockRuler
                  orientation="v"
                  count={totalRows}
                  cellPx={dynCellPx}
                  blockSizeInches={
                    blockSizeInches !== null
                      ? blockSizeInches * quiltRows
                      : null
                  }
                />
                <BlockGrid
                  cells={cells}
                  gridW={totalCols}
                  gridH={totalRows}
                  cellPx={dynCellPx}
                  onCellAction={handleCellAction}
                  gridLineOpacity={gridLineOpacity}
                  seams={seams}
                  seamTool={
                    tool === "seam-h" ? "h" : tool === "seam-v" ? "v" : null
                  }
                  onSeamToggle={handleSeamToggle}
                  snipTool={tool === "seam-snip"}
                  onSeamSnip={handleSeamSnip}
                  onDiagSnip={handleDiagSnip}
                  diagTool={
                    tool === "line-nwse"
                      ? "nwse"
                      : tool === "line-nesw"
                        ? "nesw"
                        : tool === "qline-back"
                          ? "qback"
                          : tool === "qline-fwd"
                            ? "qfwd"
                            : null
                  }
                  seamOnly={seamOnly}
                  panTool={tool === "pan"}
                  blockBoundaryGridSize={blockGridSize}
                  blockBoundaryOpacity={blockLineOpacity}
                  fabricUrlMap={fabricUrlMap}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Right panel ──────────────────────────────────────────────────── */}
        <div
          className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-l bg-background p-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (!dragPanelId || !dragOverId || dragPanelId === dragOverId) {
              setDragPanelId(null);
              setDragOverId(null);
              return;
            }
            setPanels((prev) => {
              const from = prev.findIndex((p) => p.id === dragPanelId);
              const to = prev.findIndex((p) => p.id === dragOverId);
              if (from < 0 || to < 0) return prev;
              const next = [...prev];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              return next;
            });
            setDragPanelId(null);
            setDragOverId(null);
          }}
        >
          {panels
            .filter((p) => p.open)
            .map((panel) => (
              <div
                key={panel.id}
                draggable
                onDragStart={() => setDragPanelId(panel.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverId(panel.id);
                }}
                onDragEnd={() => {
                  setDragPanelId(null);
                  setDragOverId(null);
                }}
                className={`rounded-lg border bg-background transition-colors ${
                  dragOverId === panel.id && dragPanelId !== panel.id
                    ? "border-primary"
                    : "border-border"
                }`}
              >
                {/* Panel header */}
                <div className="flex items-center gap-0.5 border-b px-1.5 py-1">
                  <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/50" />
                  <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {panel.title}
                  </span>
                  <button
                    onClick={() => togglePanel(panel.id, "minimized")}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  >
                    {panel.minimized ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    onClick={() => togglePanel(panel.id, "open")}
                    className="flex h-5 w-5 items-center justify-center rounded text-[10px] text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground"
                  >
                    ✕
                  </button>
                </div>

                {/* Colours panel */}
                {!panel.minimized && panel.id === "colours" && (
                  <div className="p-2 space-y-3">
                    {/* Slot buttons */}
                    <div className="flex gap-2">
                      {(["a", "b"] as const).map((slot) => {
                        const isActive = activeSlot === slot;
                        const color =
                          slot === "a" ? primaryColor : secondaryColor;
                        const label = slot === "a" ? "A (L/T)" : "B (R/B)";
                        return (
                          <button
                            key={slot}
                            onClick={() => setActiveSlot(slot)}
                            title={label}
                            className={`flex flex-col items-center gap-0.5 rounded px-2 py-1.5 transition-colors ${
                              isActive
                                ? "bg-primary/10 ring-2 ring-primary"
                                : "hover:bg-accent"
                            }`}
                          >
                            <div
                              className="h-7 w-7 overflow-hidden rounded border-2 border-border shadow-sm"
                              style={
                                !color
                                  ? {
                                      background:
                                        "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0 / 8px 8px",
                                    }
                                  : color.startsWith("fab:")
                                    ? {}
                                    : { backgroundColor: color }
                              }
                            >
                              {color.startsWith("fab:") &&
                                (() => {
                                  const url =
                                    fabricUrlMap[parseInt(color.slice(4), 10)];
                                  return url ? (
                                    <img
                                      src={url}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <span className="flex h-full w-full items-center justify-center text-[8px] text-muted-foreground">
                                      fab
                                    </span>
                                  );
                                })()}
                            </div>
                            <span className="text-[9px] text-muted-foreground">
                              {label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {/* Palette grid */}
                    <div className="grid grid-cols-4 gap-0.5">
                      {PALETTE.map((color) => (
                        <button
                          key={color}
                          onClick={() => {
                            if (activeSlot === "a") setPrimaryColor(color);
                            else setSecondaryColor(color);
                          }}
                          className="h-6 w-full rounded-sm border border-border/40 transition-transform hover:scale-110"
                          style={{ background: color }}
                          title={color}
                        />
                      ))}
                    </div>
                    {/* Custom hex */}
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Custom
                      </p>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={
                            activeSlot === "a" ? primaryColor : secondaryColor
                          }
                          onChange={(e) => {
                            const c = e.target.value;
                            if (activeSlot === "a") setPrimaryColor(c);
                            else setSecondaryColor(c);
                          }}
                          className="h-7 w-7 cursor-pointer rounded border border-border p-0.5"
                        />
                        <Input
                          value={
                            activeSlot === "a" ? primaryColor : secondaryColor
                          }
                          onChange={(e) => {
                            const c = e.target.value;
                            if (activeSlot === "a") setPrimaryColor(c);
                            else setSecondaryColor(c);
                          }}
                          className="h-7 text-xs font-mono"
                          placeholder="#RRGGBB"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Layout panel */}
                {!panel.minimized && panel.id === "layout" && (
                  <div className="p-2 space-y-3 text-xs">
                    {/* ── Sashing ─────────────────────────────────────────── */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                          Sashing
                        </span>
                        <button
                          onClick={() => {
                            setSashingEnabled((v) => !v);
                            setIsDirty(true);
                          }}
                          className={`relative h-4 w-8 rounded-full transition-colors ${sashingEnabled ? "bg-primary" : "bg-muted"}`}
                          title={
                            sashingEnabled
                              ? "Disable sashing"
                              : "Enable sashing"
                          }
                        >
                          <span
                            className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${sashingEnabled ? "translate-x-4" : "translate-x-0.5"}`}
                          />
                        </button>
                      </div>
                      {sashingEnabled && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-12 text-muted-foreground">
                              Width
                            </span>
                            <input
                              type="number"
                              min={0.25}
                              max={12}
                              step={0.25}
                              value={sashingWidthInches}
                              onChange={(e) => {
                                setSashingWidthInches(
                                  Math.max(
                                    0.25,
                                    Math.min(12, Number(e.target.value)),
                                  ),
                                );
                                setIsDirty(true);
                              }}
                              className="h-6 w-16 rounded border border-input bg-background px-1 text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <span className="text-muted-foreground">in</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-12 text-muted-foreground">
                              Colour
                            </span>
                            <input
                              type="color"
                              value={sashingColor}
                              onChange={(e) => {
                                setSashingColor(e.target.value);
                                setIsDirty(true);
                              }}
                              className="h-6 w-7 cursor-pointer rounded border border-border p-0.5"
                            />
                            <span className="font-mono text-muted-foreground">
                              {sashingColor}
                            </span>
                          </div>
                          {/* Cornerstones toggle */}
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">
                              Cornerstones
                            </span>
                            <button
                              onClick={() => {
                                setCornerstoneEnabled((v) => !v);
                                setIsDirty(true);
                              }}
                              className={`relative h-4 w-8 rounded-full transition-colors ${cornerstoneEnabled ? "bg-primary" : "bg-muted"}`}
                              title={
                                cornerstoneEnabled
                                  ? "Disable cornerstones"
                                  : "Enable cornerstones"
                              }
                            >
                              <span
                                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${cornerstoneEnabled ? "translate-x-4" : "translate-x-0.5"}`}
                              />
                            </button>
                          </div>
                          {cornerstoneEnabled && (
                            <div className="flex items-center gap-2">
                              <span className="w-12 text-muted-foreground">
                                Colour
                              </span>
                              <input
                                type="color"
                                value={cornerstoneColor}
                                onChange={(e) => {
                                  setCornerstoneColor(e.target.value);
                                  setIsDirty(true);
                                }}
                                className="h-6 w-7 cursor-pointer rounded border border-border p-0.5"
                              />
                              <span className="font-mono text-muted-foreground">
                                {cornerstoneColor}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-border" />

                    {/* ── Border ──────────────────────────────────────────── */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                          Border
                        </span>
                        <button
                          onClick={() => {
                            setBorderEnabled((v) => !v);
                            setIsDirty(true);
                          }}
                          className={`relative h-4 w-8 rounded-full transition-colors ${borderEnabled ? "bg-primary" : "bg-muted"}`}
                          title={
                            borderEnabled ? "Disable border" : "Enable border"
                          }
                        >
                          <span
                            className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${borderEnabled ? "translate-x-4" : "translate-x-0.5"}`}
                          />
                        </button>
                      </div>
                      {borderEnabled && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-12 text-muted-foreground">
                              Width
                            </span>
                            <input
                              type="number"
                              min={0.5}
                              max={24}
                              step={0.5}
                              value={borderWidthInches}
                              onChange={(e) => {
                                setBorderWidthInches(
                                  Math.max(
                                    0.5,
                                    Math.min(24, Number(e.target.value)),
                                  ),
                                );
                                setIsDirty(true);
                              }}
                              className="h-6 w-16 rounded border border-input bg-background px-1 text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <span className="text-muted-foreground">in</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-12 text-muted-foreground">
                              Colour
                            </span>
                            <input
                              type="color"
                              value={borderColor}
                              onChange={(e) => {
                                setBorderColor(e.target.value);
                                setIsDirty(true);
                              }}
                              className="h-6 w-7 cursor-pointer rounded border border-border p-0.5"
                            />
                            <span className="font-mono text-muted-foreground">
                              {borderColor}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="border-t border-border" />

                    {/* ── Quilt size summary ──────────────────────────────── */}
                    <div>
                      <p className="font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Finished size
                      </p>
                      {quiltFinishedW !== null && quiltFinishedH !== null ? (
                        <div className="space-y-0.5">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Quilt</span>
                            <span className="font-mono font-medium">
                              {fmtInch(quiltFinishedW)}" ×{" "}
                              {fmtInch(quiltFinishedH)}"
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Cut block
                            </span>
                            <span className="font-mono">
                              {fmtInch(cuttingSize!)}" sq
                            </span>
                          </div>
                          {sashingEnabled && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Sashing strips
                              </span>
                              <span className="font-mono">
                                {fmtInch(
                                  sashingWidthInches + 2 * seamAllowanceInches,
                                )}
                                " wide
                              </span>
                            </div>
                          )}
                          {borderEnabled && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Border strips
                              </span>
                              <span className="font-mono">
                                {fmtInch(
                                  borderWidthInches + seamAllowanceInches,
                                )}
                                " wide
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-muted-foreground">
                          Set "Finished size" in the toolbar to see
                          measurements.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Shortcuts panel */}
                {!panel.minimized && panel.id === "fabrics" && (
                  <div className="p-2">
                    <FabricPicker
                      fabrics={fabricsList}
                      activeValue={
                        activeSlot === "a" ? primaryColor : secondaryColor
                      }
                      onSelect={(val) => {
                        if (activeSlot === "a") setPrimaryColor(val);
                        else setSecondaryColor(val);
                        if (tool === "eyedropper") setTool("paint");
                      }}
                      tally={fabricTally}
                      placeholder="Click to stamp with fabric"
                    />
                  </div>
                )}

                {!panel.minimized && panel.id === "shortcuts" && (
                  <div className="p-2 space-y-2 text-xs text-muted-foreground">
                    <div>
                      <p className="font-medium text-foreground mb-1">
                        Keyboard shortcuts
                      </p>
                      <p>Z = Undo</p>
                      <p>⌘S = Save</p>
                      <p>Space = Pan (hold)</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground mb-1">
                        Diagonal seams
                      </p>
                      <p>
                        Click the <em>start</em> half of a cell for a half-seam,
                        the <em>end</em> half for the other. Both halves = full
                        corner-to-corner.
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground mb-1">
                        Extract blocks
                      </p>
                      <p>
                        Splits your design into individual blocks saved in the
                        Block Designer.
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground mb-1">
                        Block boundaries
                      </p>
                      <p>
                        The indigo overlay lines show where each block begins
                        and ends. Adjust opacity with the Blocks slider.
                      </p>
                    </div>
                    {isDirty && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 w-full text-destructive hover:text-destructive text-xs"
                        onClick={() => {
                          if (window.confirm("Discard all unsaved changes?"))
                            handleDiscard();
                        }}
                      >
                        Discard changes
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
