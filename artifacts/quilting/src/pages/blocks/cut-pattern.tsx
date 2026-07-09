import { useParams, useLocation } from "wouter";
import { useMemo } from "react";
import { useGetBlock, useListFabrics } from "@workspace/api-client-react";
import { usePageAssistantContext } from "@/lib/assistant-context";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  analyzeCutPattern,
  buildFabricRequirements,
  skillLevel,
  fmtInch,
  fmtYards,
  parseCell,
  type CutPiece,
  type FabricRequirement,
} from "@/lib/cell-parser";

const INK = "#1f2937";
const DIM = "#6b7280";

// ---------------------------------------------------------------------------
// Cell rendering (shared by every diagram on the sheet)
// ---------------------------------------------------------------------------

function CellShape({
  cell,
  x,
  y,
  size,
  fabricColorMap = {},
  fabricImageMap = {},
}: {
  cell: string;
  x: number;
  y: number;
  size: number;
  fabricColorMap?: Record<string, string>;
  fabricImageMap?: Record<string, string>;
}) {
  if (!cell)
    return <rect x={x} y={y} width={size} height={size} fill="white" />;

  function resolve(token: string): string {
    if (token.startsWith("fab:")) {
      if (fabricImageMap[token]) return `url(#fp-${token.replace(":", "-")})`;
      return fabricColorMap[token] ?? "#d4c5a9";
    }
    return token || "#eeeeee";
  }

  const parsed = parseCell(cell);

  if (parsed.kind === "triangle") {
    const a = resolve(parsed.a);
    const b = resolve(parsed.b);
    if (parsed.type === "nwse") {
      return (
        <g>
          <polygon
            points={`${x},${y} ${x + size},${y} ${x + size},${y + size}`}
            fill={a}
          />
          <polygon
            points={`${x},${y} ${x},${y + size} ${x + size},${y + size}`}
            fill={b}
          />
        </g>
      );
    }
    return (
      <g>
        <polygon
          points={`${x},${y} ${x + size},${y} ${x},${y + size}`}
          fill={a}
        />
        <polygon
          points={`${x + size},${y} ${x + size},${y + size} ${x},${y + size}`}
          fill={b}
        />
      </g>
    );
  }
  if (parsed.kind === "quad") {
    const cx = x + size / 2,
      cy = y + size / 2;
    return (
      <g>
        <polygon
          points={`${x},${y} ${x + size},${y} ${cx},${cy}`}
          fill={resolve(parsed.top)}
        />
        <polygon
          points={`${x + size},${y} ${x + size},${y + size} ${cx},${cy}`}
          fill={resolve(parsed.right)}
        />
        <polygon
          points={`${x},${y + size} ${x + size},${y + size} ${cx},${cy}`}
          fill={resolve(parsed.bottom)}
        />
        <polygon
          points={`${x},${y} ${x},${y + size} ${cx},${cy}`}
          fill={resolve(parsed.left)}
        />
      </g>
    );
  }
  if (parsed.kind === "hsplit") {
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={size}
          height={size / 2}
          fill={resolve(parsed.top)}
        />
        <rect
          x={x}
          y={y + size / 2}
          width={size}
          height={size / 2}
          fill={resolve(parsed.bottom)}
        />
      </g>
    );
  }
  if (parsed.kind === "vsplit") {
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={size / 2}
          height={size}
          fill={resolve(parsed.left)}
        />
        <rect
          x={x + size / 2}
          y={y}
          width={size / 2}
          height={size}
          fill={resolve(parsed.right)}
        />
      </g>
    );
  }
  if (parsed.kind === "xsplit") {
    const h = size / 2;
    return (
      <g>
        <rect x={x} y={y} width={h} height={h} fill={resolve(parsed.tl)} />
        <rect x={x + h} y={y} width={h} height={h} fill={resolve(parsed.tr)} />
        <rect x={x} y={y + h} width={h} height={h} fill={resolve(parsed.bl)} />
        <rect
          x={x + h}
          y={y + h}
          width={h}
          height={h}
          fill={resolve(parsed.br)}
        />
      </g>
    );
  }
  if (parsed.kind === "solid") {
    return (
      <rect
        x={x}
        y={y}
        width={size}
        height={size}
        fill={resolve(parsed.color)}
      />
    );
  }
  return <rect x={x} y={y} width={size} height={size} fill="white" />;
}

// ---------------------------------------------------------------------------
// Dimension line (technical-drawing style annotation)
// ---------------------------------------------------------------------------

function DimLine({
  x1,
  y1,
  x2,
  y2,
  label,
  horizontal,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  horizontal: boolean;
}) {
  const a = 4;
  if (horizontal) {
    const midx = (x1 + x2) / 2;
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={DIM} strokeWidth={0.75} />
        <line
          x1={x1}
          y1={y1 - 5}
          x2={x1}
          y2={y1 + 5}
          stroke={DIM}
          strokeWidth={0.75}
        />
        <line
          x1={x2}
          y1={y2 - 5}
          x2={x2}
          y2={y2 + 5}
          stroke={DIM}
          strokeWidth={0.75}
        />
        <polygon
          points={`${x1},${y1} ${x1 + a * 2},${y1 - a} ${x1 + a * 2},${y1 + a}`}
          fill={DIM}
        />
        <polygon
          points={`${x2},${y2} ${x2 - a * 2},${y2 - a} ${x2 - a * 2},${y2 + a}`}
          fill={DIM}
        />
        <rect x={midx - 26} y={y1 - 9} width={52} height={18} fill="white" />
        <text
          x={midx}
          y={y1 + 4}
          textAnchor="middle"
          fontSize={11}
          fontFamily="ui-monospace, monospace"
          fill={INK}
        >
          {label}
        </text>
      </g>
    );
  }
  const midy = (y1 + y2) / 2;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={DIM} strokeWidth={0.75} />
      <line
        x1={x1 - 5}
        y1={y1}
        x2={x1 + 5}
        y2={y1}
        stroke={DIM}
        strokeWidth={0.75}
      />
      <line
        x1={x2 - 5}
        y1={y2}
        x2={x2 + 5}
        y2={y2}
        stroke={DIM}
        strokeWidth={0.75}
      />
      <polygon
        points={`${x1},${y1} ${x1 - a},${y1 + a * 2} ${x1 + a},${y1 + a * 2}`}
        fill={DIM}
      />
      <polygon
        points={`${x2},${y2} ${x2 - a},${y2 - a * 2} ${x2 + a},${y2 - a * 2}`}
        fill={DIM}
      />
      <g transform={`translate(${x1 - 2}, ${midy}) rotate(-90)`}>
        <rect x={-26} y={-9} width={52} height={18} fill="white" />
        <text
          x={0}
          y={4}
          textAnchor="middle"
          fontSize={11}
          fontFamily="ui-monospace, monospace"
          fill={INK}
        >
          {label}
        </text>
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Dimensioned block diagram
// ---------------------------------------------------------------------------

function TechnicalBlockDiagram({
  cells,
  gridW,
  gridH,
  blockSizeInches,
  fabricColorMap = {},
  fabricImageMap = {},
}: {
  cells: string[];
  gridW: number;
  gridH: number;
  blockSizeInches: number | null;
  fabricColorMap?: Record<string, string>;
  fabricImageMap?: Record<string, string>;
}) {
  const CELL = 80;
  const M = 52;
  const w = CELL * gridW;
  const h = CELL * gridH;
  const totalW = w + M * 2;
  const totalH = h + M * 2;
  const ox = M,
    oy = M;
  const widthLabel =
    blockSizeInches !== null ? fmtInch(blockSizeInches) : `${gridW} cells`;
  const heightLabel =
    blockSizeInches !== null
      ? fmtInch(blockSizeInches * (gridH / gridW))
      : `${gridH} cells`;

  // Collect unique fab: tokens across all cells that have an image URL
  const fabTokensWithImages = useMemo(() => {
    const seen = new Set<string>();
    for (const cell of cells) {
      const matches = cell.match(/fab:\d+/g) ?? [];
      for (const t of matches) if (fabricImageMap[t]) seen.add(t);
    }
    return [...seen];
  }, [cells, fabricImageMap]);

  return (
    <svg
      width={totalW}
      height={totalH}
      viewBox={`0 0 ${totalW} ${totalH}`}
      style={{ maxWidth: "100%", height: "auto" }}
    >
      {fabTokensWithImages.length > 0 && (
        <defs>
          {fabTokensWithImages.map((token) => (
            <pattern
              key={token}
              id={`fp-${token.replace(":", "-")}`}
              patternUnits="userSpaceOnUse"
              x={ox}
              y={oy}
              width={w}
              height={h}
            >
              <image
                href={fabricImageMap[token]}
                x="0"
                y="0"
                width={w}
                height={h}
                preserveAspectRatio="xMidYMid slice"
              />
            </pattern>
          ))}
        </defs>
      )}
      {cells.map((cell, idx) => {
        const col = idx % gridW;
        const row = Math.floor(idx / gridW);
        return (
          <CellShape
            key={idx}
            cell={cell}
            x={ox + col * CELL}
            y={oy + row * CELL}
            size={CELL}
            fabricColorMap={fabricColorMap}
            fabricImageMap={fabricImageMap}
          />
        );
      })}
      {Array.from({ length: gridW + 1 }, (_, i) => (
        <line
          key={`v${i}`}
          x1={ox + i * CELL}
          y1={oy}
          x2={ox + i * CELL}
          y2={oy + h}
          stroke={INK}
          strokeWidth={0.5}
          opacity={0.45}
        />
      ))}
      {Array.from({ length: gridH + 1 }, (_, i) => (
        <line
          key={`h${i}`}
          x1={ox}
          y1={oy + i * CELL}
          x2={ox + w}
          y2={oy + i * CELL}
          stroke={INK}
          strokeWidth={0.5}
          opacity={0.45}
        />
      ))}
      <rect
        x={ox}
        y={oy}
        width={w}
        height={h}
        fill="none"
        stroke={INK}
        strokeWidth={1.5}
      />
      <DimLine
        x1={ox}
        y1={oy + h + 24}
        x2={ox + w}
        y2={oy + h + 24}
        label={widthLabel}
        horizontal
      />
      <DimLine
        x1={ox - 24}
        y1={oy}
        x2={ox - 24}
        y2={oy + h}
        label={heightLabel}
        horizontal={false}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Repeat / quilt-top layout preview
// ---------------------------------------------------------------------------

function RepeatPreview({
  cells,
  gridW,
  gridH,
  repeat = 3,
  fabricColorMap = {},
}: {
  cells: string[];
  gridW: number;
  gridH: number;
  repeat?: number;
  fabricColorMap?: Record<string, string>;
}) {
  const CELL = 9;
  const bw = CELL * gridW;
  const bh = CELL * gridH;
  const W = bw * repeat;
  const H = bh * repeat;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ maxWidth: "100%", height: "auto" }}
    >
      {Array.from({ length: repeat }).map((_, br) =>
        Array.from({ length: repeat }).map((_, bc) => (
          <g
            key={`${br}-${bc}`}
            transform={`translate(${bc * bw}, ${br * bh})`}
          >
            {cells.map((cell, idx) => {
              const col = idx % gridW;
              const row = Math.floor(idx / gridW);
              return (
                <CellShape
                  key={idx}
                  cell={cell}
                  x={col * CELL}
                  y={row * CELL}
                  size={CELL}
                  fabricColorMap={fabricColorMap}
                />
              );
            })}
          </g>
        )),
      )}
      {Array.from({ length: repeat + 1 }, (_, i) => (
        <line
          key={`bv${i}`}
          x1={i * bw}
          y1={0}
          x2={i * bw}
          y2={H}
          stroke={INK}
          strokeWidth={0.6}
          opacity={0.55}
        />
      ))}
      {Array.from({ length: repeat + 1 }, (_, i) => (
        <line
          key={`bh${i}`}
          x1={0}
          y1={i * bh}
          x2={W}
          y2={i * bh}
          stroke={INK}
          strokeWidth={0.6}
          opacity={0.55}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Cutting-technique diagrams
// ---------------------------------------------------------------------------

function TechniqueDiagram({ kind }: { kind: "hst" | "qst" }) {
  return (
    <svg width={96} height={96} viewBox="0 0 96 96">
      <rect
        x={16}
        y={16}
        width={64}
        height={64}
        fill="#f3f4f6"
        stroke={INK}
        strokeWidth={1.5}
      />
      {kind === "hst" ? (
        <line
          x1={16}
          y1={80}
          x2={80}
          y2={16}
          stroke="#b91c1c"
          strokeWidth={1.25}
          strokeDasharray="5 3"
        />
      ) : (
        <>
          <line
            x1={16}
            y1={80}
            x2={80}
            y2={16}
            stroke="#b91c1c"
            strokeWidth={1.25}
            strokeDasharray="5 3"
          />
          <line
            x1={16}
            y1={16}
            x2={80}
            y2={80}
            stroke="#b91c1c"
            strokeWidth={1.25}
            strokeDasharray="5 3"
          />
        </>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Piece shape icon (for the cutting list)
// ---------------------------------------------------------------------------

function ShapeIcon({ piece, size = 28 }: { piece: CutPiece; size?: number }) {
  const color = piece.colors[0] ?? "#e0e0e0";
  const s = size;
  if (piece.shape === "hst") {
    return (
      <svg width={s} height={s} viewBox="0 0 32 32">
        <polygon
          points="0,32 32,0 32,32"
          fill={color}
          stroke={INK}
          strokeWidth={0.8}
        />
        <polygon
          points="0,32 32,0 0,0"
          fill="white"
          stroke={INK}
          strokeWidth={0.8}
        />
      </svg>
    );
  }
  if (piece.shape === "qst") {
    return (
      <svg width={s} height={s} viewBox="0 0 32 32">
        <polygon
          points="16,16 0,0 32,0"
          fill={color}
          stroke={INK}
          strokeWidth={0.8}
        />
        <polygon
          points="16,16 0,0 0,32"
          fill="white"
          stroke={INK}
          strokeWidth={0.8}
        />
        <polygon
          points="16,16 0,32 32,32"
          fill="white"
          stroke={INK}
          strokeWidth={0.8}
        />
        <polygon
          points="16,16 32,0 32,32"
          fill="white"
          stroke={INK}
          strokeWidth={0.8}
        />
      </svg>
    );
  }
  const aspect =
    piece.finishedW !== null &&
    piece.finishedH !== null &&
    piece.finishedH !== 0
      ? piece.finishedW / piece.finishedH
      : 1;
  const rw = aspect >= 1 ? s : Math.round(s * aspect);
  const rh = aspect <= 1 ? s : Math.round(s / aspect);
  return (
    <svg width={rw} height={rh} viewBox={`0 0 ${rw} ${rh}`}>
      <rect
        width={rw}
        height={rh}
        fill={color}
        stroke={INK}
        strokeWidth={0.8}
        rx={1}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Cut instruction text (published-pattern convention)
// ---------------------------------------------------------------------------

function sizeStr(piece: CutPiece): string {
  if (piece.cutW === null || piece.cutH === null) return "";
  return piece.cutW === piece.cutH
    ? fmtInch(piece.cutW)
    : `${fmtInch(piece.cutW)} × ${fmtInch(piece.cutH)}`;
}

function cutInstruction(piece: CutPiece, hasDimensions: boolean): string {
  const n = piece.count;
  const plural = n === 1 ? "" : "s";
  const sz = hasDimensions ? sizeStr(piece) : "";
  const sizePart = sz ? `${sz} ` : "";
  switch (piece.shape) {
    case "square":
      return `Cut (${n}) ${sizePart}square${plural}.`;
    case "rectangle":
      return `Cut (${n}) ${sizePart}rectangle${plural}.`;
    case "hst":
      return `Cut (${n}) ${sizePart}square${plural}; slice once on the diagonal for half-square triangles.`;
    case "qst":
      return `Cut (${n}) ${sizePart}square${plural}; cut twice on the diagonal (an X) for quarter-square triangles.`;
    default:
      return `Cut (${n}) ${sizePart}piece${plural}.`;
  }
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionTitle({
  no,
  children,
}: {
  no: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2 border-b border-foreground/20 pb-1">
      <span className="font-mono text-xs text-muted-foreground">
        {String(no).padStart(2, "0")}
      </span>
      <h2 className="font-serif text-base font-semibold tracking-tight">
        {children}
      </h2>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Print stylesheet
// ---------------------------------------------------------------------------

const PRINT_CSS = `
.pattern-sheet, .pattern-sheet * {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
@media print {
  @page { size: letter portrait; margin: 0.5in; }
  .no-print { display: none !important; }
  .pattern-sheet { box-shadow: none !important; border: none !important; max-width: none !important; padding: 0 !important; }
  .pattern-section { break-inside: avoid; }
}
`;

// ---------------------------------------------------------------------------
// Thread & stitch helpers
// ---------------------------------------------------------------------------

function suggestThread(color: string): { hex: string; name: string } {
  if (!color || color.startsWith("fab:")) {
    return { hex: "#9ca3af", name: "Neutral grey" };
  }
  try {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b))
      return { hex: "#9ca3af", name: "Neutral grey" };
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum > 0.72) return { hex: "#6b7280", name: "Medium grey" };
    if (lum < 0.15) return { hex: "#374151", name: "Dark charcoal" };
    const factor = 0.72;
    const dr = Math.round(r * factor)
      .toString(16)
      .padStart(2, "0");
    const dg = Math.round(g * factor)
      .toString(16)
      .padStart(2, "0");
    const db = Math.round(b * factor)
      .toString(16)
      .padStart(2, "0");
    return { hex: `#${dr}${dg}${db}`, name: "Matching (slightly darker)" };
  } catch {
    return { hex: "#9ca3af", name: "Neutral grey" };
  }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CutPatternPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const blockId = Number(id);

  const { data: block, isLoading } = useGetBlock(blockId);
  const { data: fabricsData } = useListFabrics({ pageSize: 200 });
  const fabricsList = fabricsData?.items;

  usePageAssistantContext(
    "quilting-cut-pattern",
    isLoading || !block
      ? undefined
      : `Cut Pattern page for block "${block.name}" (id ${block.id}): a printable cutting diagram and fabric-requirements sheet derived from the block's grid. Informational/printable only, no chat-editable content here.`,
  );

  const fabricColorMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const f of fabricsList ?? []) {
      const color = f.dominantColors?.[0] ?? "#d4c5a9";
      map[`fab:${f.id}`] = color;
    }
    return map;
  }, [fabricsList]);

  const fabricNameMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const f of fabricsList ?? []) {
      map[`fab:${f.id}`] = f.name;
    }
    return map;
  }, [fabricsList]);

  const fabricImageMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const f of fabricsList ?? []) {
      if (f.imageUrl) map[`fab:${f.id}`] = f.imageUrl;
    }
    return map;
  }, [fabricsList]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!block) {
    return <div className="p-6 text-muted-foreground">Block not found.</div>;
  }

  const gridSize = block.gridSize;
  const cells = block.cells ?? [];
  const gridH =
    cells.length > 0 && cells.length % gridSize === 0
      ? cells.length / gridSize
      : gridSize;
  const blockSizeInches = block.blockSizeInches ?? null;
  const seamAllowance = block.seamAllowanceInches ?? 0.25;
  const hasDimensions = blockSizeInches !== null;

  const pieces = analyzeCutPattern(
    cells,
    gridSize,
    gridH,
    blockSizeInches,
    seamAllowance,
  );
  const fabrics = buildFabricRequirements(pieces, hasDimensions);
  const level = skillLevel(pieces);
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const totalPieces = pieces.reduce((s, p) => s + p.count, 0);

  const hasHst = pieces.some((p) => p.shape === "hst");
  const hasQst = pieces.some((p) => p.shape === "qst");

  return (
    <div className="bg-muted/30 print:bg-white">
      <style>{PRINT_CSS}</style>

      {/* Screen toolbar */}
      <div className="no-print sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-6 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigate(`/blocks/${blockId}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-medium">{block.name} — Pattern</h1>
        <Button
          variant="default"
          size="sm"
          className="ml-auto"
          onClick={() => window.print()}
        >
          <Printer className="mr-2 h-4 w-4" />
          Print / Save PDF
        </Button>
      </div>

      {/* The pattern sheet */}
      <div className="pattern-sheet mx-auto my-6 max-w-[8.5in] bg-white p-8 text-foreground shadow-sm print:my-0 print:shadow-none">
        {/* ---- Title block ---- */}
        <header className="pattern-section mb-6 flex items-end justify-between gap-6 border-b-2 border-foreground pb-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Quilt Block Pattern
            </p>
            <h1 className="mt-1 font-serif text-3xl font-bold leading-none tracking-tight">
              {block.name}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A pieced quilt block · repeat to build a quilt top of any size.
            </p>
          </div>
          <table className="shrink-0 border border-foreground/30 text-[11px]">
            <tbody className="font-mono">
              {[
                [
                  "Finished block",
                  hasDimensions ? `${fmtInch(blockSizeInches!)} sq` : "—",
                ],
                ["Grid", `${gridSize} × ${gridH}`],
                [
                  "Cell (finished)",
                  hasDimensions
                    ? gridSize === gridH
                      ? fmtInch(blockSizeInches! / gridSize)
                      : `${fmtInch(blockSizeInches! / gridSize)} × ${fmtInch(blockSizeInches! / gridH)}`
                    : "—",
                ],
                ["Seam allowance", fmtInch(seamAllowance)],
                ["Skill", level],
                ["Date", today],
              ].map(([k, v]) => (
                <tr
                  key={k}
                  className="border-b border-foreground/15 last:border-0"
                >
                  <td className="border-r border-foreground/15 px-2 py-1 text-muted-foreground">
                    {k}
                  </td>
                  <td className="px-2 py-1 text-right font-medium text-foreground">
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </header>

        {!hasDimensions && (
          <div className="no-print mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No finished size is set for this block, so yardage and cut sizes
            can’t be calculated. Open the designer and set a finished block size
            to generate a complete, cut-ready pattern.
          </div>
        )}

        {/* ---- 01 Diagram ---- */}
        <section className="pattern-section mb-7">
          <SectionTitle no={1}>Block diagram &amp; layout</SectionTitle>
          <figure className="m-0 inline-block">
            <TechnicalBlockDiagram
              cells={cells}
              gridW={gridSize}
              gridH={gridH}
              blockSizeInches={blockSizeInches}
              fabricColorMap={fabricColorMap}
              fabricImageMap={fabricImageMap}
            />
            <figcaption className="mt-1 text-center text-xs text-muted-foreground">
              One block — sewn, finished size shown.
            </figcaption>
          </figure>
        </section>

        {/* ---- 02 Fabric requirements ---- */}
        <section className="pattern-section mb-7">
          <SectionTitle no={2}>Fabric requirements</SectionTitle>
          {fabrics.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No coloured fabric pieces in this block.
            </p>
          ) : (
            <>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-foreground/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-2 font-medium">Fabric</th>
                    <th className="py-1.5 px-2 font-medium">Swatch</th>
                    <th className="py-1.5 px-2 font-medium">Colour</th>
                    <th className="py-1.5 px-2 text-right font-medium">
                      Pieces
                    </th>
                    {hasDimensions && (
                      <th className="py-1.5 pl-2 text-right font-medium">
                        Buy (per block)
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {fabrics.map((f) => {
                    const isFab = f.color.startsWith("fab:");
                    const imageUrl = isFab ? fabricImageMap[f.color] : null;
                    const swatchBg = isFab
                      ? (fabricColorMap[f.color] ?? "#d4c5a9")
                      : f.color;
                    const colorLabel = isFab
                      ? (fabricNameMap[f.color] ?? f.color)
                      : f.color;
                    return (
                      <tr
                        key={f.color}
                        className="border-b border-foreground/10"
                      >
                        <td className="py-2 pr-2 font-mono font-semibold">
                          Fabric {f.letter}
                        </td>
                        <td className="py-2 px-2">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={colorLabel}
                              className="h-8 w-12 rounded-sm border border-foreground/30 object-cover"
                            />
                          ) : (
                            <span
                              className="inline-block h-5 w-8 rounded-sm border border-foreground/30"
                              style={{ background: swatchBg }}
                            />
                          )}
                        </td>
                        <td className="py-2 px-2 text-xs text-muted-foreground">
                          {colorLabel}
                        </td>
                        <td className="py-2 px-2 text-right font-medium">
                          {f.pieceCount}
                        </td>
                        {hasDimensions && (
                          <td className="py-2 pl-2 text-right font-medium">
                            {f.yards !== null ? fmtYards(f.yards) : "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {hasDimensions && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Yardage is estimated from 42&quot;-wide fabric, includes ~15%
                  for trimming and waste, and is rounded up to the nearest ⅛
                  yard. Multiply by the number of blocks in your quilt, then
                  round up when purchasing.
                </p>
              )}
            </>
          )}
        </section>

        {/* ---- 03 Cutting instructions ---- */}
        <section className="pattern-section mb-7">
          <SectionTitle no={3}>Cutting instructions</SectionTitle>
          {fabrics.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              Nothing to cut.
            </p>
          ) : (
            <div className="space-y-4">
              {fabrics.map((f) => {
                const isFabC = f.color.startsWith("fab:");
                const imgUrlC = isFabC ? fabricImageMap[f.color] : null;
                return (
                  <div key={f.color}>
                    <div className="mb-1.5 flex items-center gap-2 border-b border-foreground/15 pb-1">
                      {imgUrlC ? (
                        <img
                          src={imgUrlC}
                          alt={fabricNameMap[f.color] ?? f.color}
                          className="h-5 w-5 rounded-sm border border-foreground/30 object-cover"
                        />
                      ) : (
                        <span
                          className="inline-block h-4 w-4 rounded-sm border border-foreground/30"
                          style={{
                            background: isFabC
                              ? (fabricColorMap[f.color] ?? "#d4c5a9")
                              : f.color,
                          }}
                        />
                      )}
                      <span className="font-mono text-sm font-semibold">
                        Fabric {f.letter}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {isFabC ? (fabricNameMap[f.color] ?? f.color) : f.color}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {f.pieces.map((piece, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="mt-0.5 shrink-0">
                            <ShapeIcon piece={piece} size={26} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm leading-snug">
                              {cutInstruction(piece, hasDimensions)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {piece.label}
                              {hasDimensions &&
                                piece.finishedW !== null &&
                                piece.finishedH !== null && (
                                  <>
                                    {" "}
                                    · finishes{" "}
                                    {piece.finishedW === piece.finishedH
                                      ? fmtInch(piece.finishedW)
                                      : `${fmtInch(piece.finishedW)} × ${fmtInch(piece.finishedH)}`}
                                  </>
                                )}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ---- 04 Cutting techniques ---- */}
        {(hasHst || hasQst) && (
          <section className="pattern-section mb-7">
            <SectionTitle no={4}>Cutting techniques</SectionTitle>
            <div className="flex flex-wrap gap-8">
              {hasHst && (
                <div className="flex items-center gap-3">
                  <TechniqueDiagram kind="hst" />
                  <div className="max-w-[15rem] text-sm">
                    <p className="font-medium">Half-square triangles (HST)</p>
                    <p className="text-xs text-muted-foreground">
                      Cut the listed square, then slice <strong>once</strong>{" "}
                      corner-to-corner. Each square yields 2 triangles. Press
                      toward the darker fabric.
                    </p>
                  </div>
                </div>
              )}
              {hasQst && (
                <div className="flex items-center gap-3">
                  <TechniqueDiagram kind="qst" />
                  <div className="max-w-[15rem] text-sm">
                    <p className="font-medium">
                      Quarter-square triangles (QST)
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Cut the listed square, then slice <strong>once</strong> on
                      each diagonal (forming an X). Each square yields 4
                      triangles. Press seams in a pinwheel to reduce bulk.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Triangle source squares are cut <strong>oversize</strong>{" "}
              (HST&nbsp;+{fmtInch(0.875 * (seamAllowance / 0.25))}, QST&nbsp;+
              {fmtInch(1.25 * (seamAllowance / 0.25))} at a{" "}
              {fmtInch(seamAllowance)} seam); piece, then trim each finished
              unit square and true up before assembly.
            </p>
          </section>
        )}

        {/* ---- 05 Assembly ---- */}
        <section className="pattern-section mb-6">
          <SectionTitle no={5}>Assembly</SectionTitle>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              Lay out all pieces following the block diagram above, {gridSize}{" "}
              across and {gridH} down.
            </li>
            <li>
              Sew pieced units (HST/QST) first; trim each to its listed size and
              square up.
            </li>
            <li>
              Join pieces into rows, pressing seams in alternating directions so
              they nest.
            </li>
            <li>
              Sew the rows together, matching seams, to complete one{" "}
              {hasDimensions ? `${fmtInch(blockSizeInches!)} ` : ""}block. Total
              pieces per block: {totalPieces}.
            </li>
            <li>
              Repeat for the number of blocks your quilt needs, then assemble
              blocks into rows for the quilt top.
            </li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            All measurements include a {fmtInch(seamAllowance)} seam allowance
            per side. Sew with a scant {fmtInch(seamAllowance)} seam for
            accurate piecing.
          </p>
        </section>

        {/* ---- 06 Thread & stitch guide ---- */}
        {fabrics.length > 0 && (
          <section className="pattern-section mb-7">
            <SectionTitle no={6}>Thread &amp; stitch guide</SectionTitle>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-foreground/20 text-left text-xs text-muted-foreground">
                  <th className="pb-1 pr-4 font-medium">Fabric</th>
                  <th className="pb-1 pr-4 font-medium">Suggested thread</th>
                  <th className="pb-1 font-medium">Needle</th>
                </tr>
              </thead>
              <tbody>
                {fabrics.map((f, i) => {
                  const isFabT = f.color.startsWith("fab:");
                  const imgUrlT = isFabT ? fabricImageMap[f.color] : null;
                  const resolvedColor = isFabT
                    ? (fabricColorMap[f.color] ?? "#d4c5a9")
                    : f.color;
                  const thread = suggestThread(resolvedColor);
                  return (
                    <tr key={i} className="border-b border-foreground/10">
                      <td className="py-1.5 pr-4">
                        <div className="flex items-center gap-2">
                          {imgUrlT ? (
                            <img
                              src={imgUrlT}
                              alt={fabricNameMap[f.color] ?? f.color}
                              className="h-5 w-5 shrink-0 rounded-sm border border-foreground/20 object-cover"
                            />
                          ) : (
                            <span
                              className="inline-block h-4 w-4 shrink-0 rounded-sm border border-foreground/20"
                              style={{ background: resolvedColor }}
                            />
                          )}
                          <span className="text-xs text-muted-foreground">
                            Fabric {f.letter}
                          </span>
                        </div>
                      </td>
                      <td className="py-1.5 pr-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-4 w-4 shrink-0 rounded-sm border border-foreground/20"
                            style={{ background: thread.hex }}
                          />
                          <span className="text-sm">{thread.name}</span>
                        </div>
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground">
                        80/12 Universal
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <p>
                <strong>Stitch:</strong> 2.5 mm straight stitch (≈ 10–12
                stitches/inch) for all piecing seams.
              </p>
              <p>
                <strong>Thread weight:</strong> 50 wt 100% cotton or
                cotton-wrapped polyester.
              </p>
              <p>
                <strong>Pressing:</strong> press seams toward the darker fabric;
                open if bulk is a concern.
              </p>
              <p>
                <strong>Quilting stitch:</strong> 40 wt thread and a 90/14
                quilting needle once the top is assembled.
              </p>
            </div>
          </section>
        )}

        {/* ---- Footer ---- */}
        <footer className="mt-8 flex items-center justify-between border-t border-foreground/20 pt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Batchelor Quilting · {block.name}</span>
          <span>Generated {today}</span>
        </footer>
      </div>
    </div>
  );
}
