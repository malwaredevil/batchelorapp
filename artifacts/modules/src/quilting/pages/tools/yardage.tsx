import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Calculator,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  ShoppingCart,
  Ruler,
} from "lucide-react";
import { toast } from "sonner";
import {
  useListFabrics,
  useCreateShoppingItem,
} from "@workspace/api-client-react";
import type { QuiltingFabric } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { colorToHex } from "@workspace/web-core";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";

// ── Helpers ────────────────────────────────────────────────────────────────────

function quantityToYards(fabric: QuiltingFabric): number {
  const { quantity, quantityUnit } = fabric;
  const u = quantityUnit.toLowerCase();
  if (u === "meters" || u === "metre" || u === "metres")
    return quantity * 1.0936;
  if (u === "fat quarters" || u === "fat quarter") return quantity * 0.25;
  if (u === "fat eighths" || u === "fat eighth") return quantity * 0.125;
  return quantity; // yards (default)
}

/** Compute yardage breakdown for one fabric and a target block count. */
function computeFabricYardage(
  fabric: QuiltingFabric,
  targetBlocks: number,
  cutBlockSize: number,
): {
  availableYards: number;
  fabricWidth: number;
  blocksPerRow: number;
  blocksAvailable: number;
  yardsNeeded: number;
  shortfallYards: number;
  sufficient: boolean;
} {
  const fabricWidth = fabric.widthInches ?? 44;
  const availableYards = quantityToYards(fabric);

  const blocksPerRow = Math.max(1, Math.floor(fabricWidth / cutBlockSize));
  const rowsAvailable = Math.floor((availableYards * 36) / cutBlockSize);
  const blocksAvailable = blocksPerRow * rowsAvailable;

  const rowsNeeded = Math.ceil(targetBlocks / blocksPerRow);
  const yardsNeeded = parseFloat(((rowsNeeded * cutBlockSize) / 36).toFixed(2));
  const shortfallYards = Math.max(
    0,
    parseFloat((yardsNeeded - availableYards).toFixed(2)),
  );
  const sufficient = shortfallYards === 0;

  return {
    availableYards,
    fabricWidth,
    blocksPerRow,
    blocksAvailable,
    yardsNeeded,
    shortfallYards,
    sufficient,
  };
}

/** Round up to the nearest 0.25-yard increment. */
function roundUpToQuarter(yards: number): number {
  return Math.ceil(yards * 4) / 4;
}

/** Split `total` into `n` integer parts that are as even as possible and sum exactly to `total`. */
function distributeEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NumericField({
  id,
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="relative flex items-center">
        <Input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 0.5}
          onChange={(e) => onChange(e.target.value)}
          className="pr-12"
        />
        {suffix && (
          <span className="absolute right-3 text-xs text-muted-foreground pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function FabricRow({
  fabric,
  selected,
  onToggle,
}: {
  fabric: QuiltingFabric;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-card-border bg-card hover:border-primary/30"
      }`}
      onClick={onToggle}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={onToggle}
        className="shrink-0"
      />
      <img
        src={fabric.imageUrl}
        alt={fabric.name}
        className="h-10 w-10 shrink-0 rounded-md object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{fabric.name}</p>
        {fabric.designer && (
          <p className="truncate text-xs text-muted-foreground">
            {fabric.designer}
          </p>
        )}
        {fabric.dominantColors.length > 0 && (
          <div className="mt-1 flex gap-1">
            {fabric.dominantColors.slice(0, 5).map((c, i) => (
              <span
                key={i}
                className="h-3 w-3 rounded-full border border-border/30"
                style={{ backgroundColor: colorToHex(c) }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-primary">
          {fabric.quantity} {fabric.quantityUnit}
        </p>
        {fabric.widthInches && (
          <p className="text-xs text-muted-foreground">
            {fabric.widthInches}"W
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function YardageCalculator() {
  const { data: fabricsData, isLoading } = useListFabrics({ pageSize: 200 });
  const fabrics = fabricsData?.items;

  usePageAssistantContext(
    "quilting-yardage-calculator",
    "Yardage Calculator page: interactive tool for computing backing/binding/block-cutting fabric yardage needed for a target quilt size. You have a calculate_yardage informational action tool that can run the same calculation from chat.",
  );

  const [quiltWidth, setQuiltWidth] = useState("60");
  const [quiltHeight, setQuiltHeight] = useState("72");
  const [blockSize, setBlockSize] = useState("12");
  const [seamAllowance, setSeamAllowance] = useState("0.25");
  const [includeBinding, setIncludeBinding] = useState(true);
  const [includeBacking, setIncludeBacking] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showFabricList, setShowFabricList] = useState(true);
  const [addingShortfalls, setAddingShortfalls] = useState<Set<number>>(
    new Set(),
  );
  const [addedToList, setAddedToList] = useState<Set<number>>(new Set());
  const [blockAllocations, setBlockAllocations] = useState<
    Record<number, string>
  >({});

  const createShoppingItem = useCreateShoppingItem();

  function toggleFabric(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBlockAllocations((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function setFabricBlocks(id: number, value: string) {
    setBlockAllocations((prev) => ({ ...prev, [id]: value }));
  }

  function resetToEvenSplit() {
    setBlockAllocations({});
  }

  const selectedFabrics = useMemo(
    () => (fabrics ?? []).filter((f) => selectedIds.has(f.id)),
    [fabrics, selectedIds],
  );

  const calc = useMemo(() => {
    const w = parseFloat(quiltWidth) || 0;
    const h = parseFloat(quiltHeight) || 0;
    const bs = parseFloat(blockSize) || 0;
    const sa = parseFloat(seamAllowance) || 0.25;

    if (w <= 0 || h <= 0 || bs <= 0) return null;

    const cutBlock = bs + sa * 2;
    const blocksAcross = Math.max(1, Math.floor(w / bs));
    const blocksDown = Math.max(1, Math.floor(h / bs));
    const totalBlocks = blocksAcross * blocksDown;

    const evenSplit = distributeEvenly(totalBlocks, selectedFabrics.length);

    const fabricResults = selectedFabrics.map((f, i) => {
      const rawOverride = blockAllocations[f.id];
      const overrideNum =
        rawOverride !== undefined && rawOverride !== ""
          ? parseInt(rawOverride, 10)
          : NaN;
      const isOverridden = !Number.isNaN(overrideNum) && overrideNum >= 0;
      const targetBlocks = isOverridden ? overrideNum : (evenSplit[i] ?? 0);

      return {
        fabric: f,
        ...computeFabricYardage(f, targetBlocks, cutBlock),
        targetBlocks,
        isOverridden,
      };
    });

    const allocatedBlocksTotal = fabricResults.reduce(
      (s, r) => s + r.targetBlocks,
      0,
    );
    const allocationMismatch =
      selectedFabrics.length > 0 && allocatedBlocksTotal !== totalBlocks;

    const totalBlocksAvailable = fabricResults.reduce(
      (s, r) => s + r.blocksAvailable,
      0,
    );

    // Binding (2.5" strips, standard 1/4" seam binding)
    const bindingYards = (() => {
      if (!includeBinding) return 0;
      const perimeterInches = 2 * (w + h) + 12;
      const defaultWidth = 44;
      const stripsNeeded = Math.ceil(perimeterInches / defaultWidth);
      return roundUpToQuarter((stripsNeeded * 2.5) / 36);
    })();

    // Backing (8" extra each side)
    const backingYards = (() => {
      if (!includeBacking) return 0;
      const backingWidth = 44;
      const safeWidth = w + 8;
      const safeHeight = h + 8;
      const lengths = Math.ceil(safeWidth / backingWidth);
      return roundUpToQuarter((lengths * safeHeight) / 36);
    })();

    return {
      w,
      h,
      bs,
      cutBlock,
      blocksAcross,
      blocksDown,
      totalBlocks,
      fabricResults,
      allocatedBlocksTotal,
      allocationMismatch,
      totalBlocksAvailable,
      allSufficient: fabricResults.every((r) => r.sufficient),
      bindingYards,
      backingYards,
    };
  }, [
    quiltWidth,
    quiltHeight,
    blockSize,
    seamAllowance,
    includeBinding,
    includeBacking,
    selectedFabrics,
    blockAllocations,
  ]);

  async function addShortfallToList(
    fabricId: number,
    fabricName: string,
    shortfallYards: number,
  ) {
    setAddingShortfalls((s) => new Set([...s, fabricId]));
    const qty = roundUpToQuarter(shortfallYards + 0.25); // add 0.25 yd buffer
    try {
      await createShoppingItem.mutateAsync({
        data: {
          name: `${fabricName} (extra yardage for quilt)`,
          quantity: qty,
          unit: "yards",
          notes: `Shortfall from yardage calculator — need ~${shortfallYards} yd more`,
          status: "want",
        },
      });
      setAddedToList((s) => new Set([...s, fabricId]));
      toast.success(`Added ${qty} yd of "${fabricName}" to shopping list`);
    } catch {
      toast.error("Failed to add to shopping list");
    } finally {
      setAddingShortfalls((s) => {
        const n = new Set(s);
        n.delete(fabricId);
        return n;
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/quilting/fabrics">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Yardage Calculator
          </h1>
          <p className="text-sm text-muted-foreground">
            Estimate fabric needed for your quilt and spot shortfalls
          </p>
        </div>
      </div>

      {/* Quilt parameters */}
      <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Ruler className="h-4 w-4 text-primary" />
          Quilt dimensions
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumericField
            id="quilt-width"
            label="Quilt width"
            value={quiltWidth}
            onChange={setQuiltWidth}
            min={1}
            suffix="in"
          />
          <NumericField
            id="quilt-height"
            label="Quilt height"
            value={quiltHeight}
            onChange={setQuiltHeight}
            min={1}
            suffix="in"
          />
          <NumericField
            id="block-size"
            label="Block size"
            hint="Finished"
            value={blockSize}
            onChange={setBlockSize}
            min={1}
            step={0.5}
            suffix="in"
          />
          <NumericField
            id="seam-allowance"
            label="Seam allowance"
            hint="Each side"
            value={seamAllowance}
            onChange={setSeamAllowance}
            min={0.125}
            max={0.5}
            step={0.125}
            suffix="in"
          />
        </div>

        {calc && (
          <div className="flex flex-wrap gap-4 rounded-lg bg-muted/40 px-4 py-3 text-sm">
            <span>
              <span className="font-semibold text-foreground">
                {calc.blocksAcross} × {calc.blocksDown}
              </span>
              <span className="ml-1 text-muted-foreground">block layout</span>
            </span>
            <span>
              <span className="font-semibold text-foreground">
                {calc.totalBlocks}
              </span>
              <span className="ml-1 text-muted-foreground">total blocks</span>
            </span>
            <span>
              <span className="font-semibold text-foreground">
                {calc.cutBlock.toFixed(2)}"
              </span>
              <span className="ml-1 text-muted-foreground">cut block size</span>
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2">
            <Checkbox
              id="include-binding"
              checked={includeBinding}
              onCheckedChange={(v) => setIncludeBinding(Boolean(v))}
            />
            <Label htmlFor="include-binding" className="text-sm cursor-pointer">
              Include binding estimate
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="include-backing"
              checked={includeBacking}
              onCheckedChange={(v) => setIncludeBacking(Boolean(v))}
            />
            <Label htmlFor="include-backing" className="text-sm cursor-pointer">
              Include backing estimate
            </Label>
          </div>
        </div>

        {calc && (includeBinding || includeBacking) && (
          <div className="flex flex-wrap gap-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-sm">
            {includeBinding && (
              <span>
                <span className="font-semibold">~{calc.bindingYards} yd</span>
                <span className="ml-1 text-muted-foreground">
                  binding (2.5" strips, 44" fabric)
                </span>
              </span>
            )}
            {includeBacking && (
              <span>
                <span className="font-semibold">~{calc.backingYards} yd</span>
                <span className="ml-1 text-muted-foreground">
                  backing (44" fabric)
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Fabric selector */}
      <div className="rounded-xl border border-card-border bg-card">
        <button
          className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold"
          onClick={() => setShowFabricList((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            Select fabrics from your stash
            {selectedIds.size > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                {selectedIds.size} selected
              </span>
            )}
          </div>
          {showFabricList ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {showFabricList && (
          <div className="border-t border-card-border px-4 pb-4 pt-3">
            {isLoading && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Loading fabrics…
              </p>
            )}
            {!isLoading && (!fabrics || fabrics.length === 0) && (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No fabrics in your stash yet
                </p>
                <Button variant="link" size="sm" asChild className="mt-1">
                  <Link href="/quilting/fabrics/add">
                    Add your first fabric
                  </Link>
                </Button>
              </div>
            )}
            {fabrics && fabrics.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {fabrics.map((f) => (
                  <FabricRow
                    key={f.id}
                    fabric={f as QuiltingFabric}
                    selected={selectedIds.has(f.id)}
                    onToggle={() => toggleFabric(f.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      {calc && selectedFabrics.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-sm font-semibold">Per-fabric breakdown</h2>
            <span
              className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                calc.allSufficient
                  ? "bg-green-500/15 text-green-700 dark:text-green-400"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              }`}
            >
              {calc.allSufficient ? (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  All sufficient
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3 w-3" />
                  Shortfalls detected
                </>
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-card-border px-5 py-2.5 text-xs">
            <span className="text-muted-foreground">
              Blocks allocated:{" "}
              <span
                className={`font-semibold ${
                  calc.allocationMismatch
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-foreground"
                }`}
              >
                {calc.allocatedBlocksTotal}
              </span>{" "}
              / {calc.totalBlocks} needed
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={resetToEvenSplit}
            >
              Distribute evenly
            </Button>
          </div>

          {calc.allocationMismatch && (
            <div className="flex items-center gap-2 border-t border-amber-500/20 bg-amber-500/5 px-5 py-2.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Per-fabric block counts add up to {calc.allocatedBlocksTotal},
                but the quilt needs {calc.totalBlocks}. Adjust the counts below
                so they match.
              </span>
            </div>
          )}

          <div className="border-t border-card-border divide-y divide-card-border">
            {calc.fabricResults.map((r) => (
              <div key={r.fabric.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <img
                    src={r.fabric.imageUrl}
                    alt={r.fabric.name}
                    className="h-11 w-11 shrink-0 rounded-md object-cover mt-0.5"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{r.fabric.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.fabricWidth}" wide · {r.blocksPerRow} blocks/strip
                        </p>
                      </div>
                      <span
                        className={`mt-0.5 shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          r.sufficient
                            ? "bg-green-500/15 text-green-700 dark:text-green-400"
                            : "bg-red-500/15 text-red-700 dark:text-red-400"
                        }`}
                      >
                        {r.sufficient ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <AlertTriangle className="h-3 w-3" />
                        )}
                        {r.sufficient ? "OK" : "Short"}
                      </span>
                    </div>

                    <div className="flex items-end gap-2">
                      <div className="w-28">
                        <Label
                          htmlFor={`blocks-${r.fabric.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Blocks for this fabric
                        </Label>
                        <Input
                          id={`blocks-${r.fabric.id}`}
                          type="number"
                          min={0}
                          step={1}
                          value={
                            blockAllocations[r.fabric.id] ??
                            String(r.targetBlocks)
                          }
                          onChange={(e) =>
                            setFabricBlocks(r.fabric.id, e.target.value)
                          }
                          className="h-8 text-sm"
                        />
                      </div>
                      {!r.isOverridden && (
                        <span className="mb-1.5 text-xs text-muted-foreground">
                          (even split)
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                      <div>
                        <p className="text-muted-foreground">Need</p>
                        <p className="font-semibold">{r.yardsNeeded} yd</p>
                        <p className="text-muted-foreground">
                          ({r.targetBlocks} blocks)
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Available</p>
                        <p className="font-semibold">
                          {r.availableYards.toFixed(2)} yd
                        </p>
                        <p className="text-muted-foreground">
                          ({r.blocksAvailable} blocks)
                        </p>
                      </div>
                      {!r.sufficient && (
                        <div className="col-span-2 sm:col-span-2">
                          <p className="text-muted-foreground">Shortfall</p>
                          <p className="font-semibold text-red-600 dark:text-red-400">
                            {r.shortfallYards} yd needed
                          </p>
                        </div>
                      )}
                    </div>

                    {!r.sufficient && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1 h-7 text-xs"
                        disabled={
                          addingShortfalls.has(r.fabric.id) ||
                          addedToList.has(r.fabric.id)
                        }
                        onClick={() =>
                          addShortfallToList(
                            r.fabric.id,
                            r.fabric.name,
                            r.shortfallYards,
                          )
                        }
                      >
                        {addedToList.has(r.fabric.id) ? (
                          <>
                            <CheckCircle2 className="mr-1.5 h-3 w-3 text-green-600" />
                            Added to list
                          </>
                        ) : addingShortfalls.has(r.fabric.id) ? (
                          "Adding…"
                        ) : (
                          <>
                            <ShoppingCart className="mr-1.5 h-3 w-3" />
                            Add {roundUpToQuarter(r.shortfallYards + 0.25)} yd
                            to shopping list
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer summary */}
          <div className="border-t border-card-border px-5 py-3 bg-muted/20 rounded-b-xl">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>
                Total blocks available:{" "}
                <strong className="text-foreground">
                  {calc.totalBlocksAvailable}
                </strong>{" "}
                / {calc.totalBlocks} needed
              </span>
              {calc.totalBlocksAvailable >= calc.totalBlocks && (
                <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
                  <CheckCircle2 className="h-3 w-3" />
                  Enough fabric for the whole quilt
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {calc && selectedFabrics.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-10 text-center">
          <Calculator className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            Select fabrics above to see the yardage breakdown
          </p>
        </div>
      )}

      {!calc && (
        <div className="rounded-xl border border-dashed border-border py-10 text-center">
          <Ruler className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            Enter quilt dimensions and block size to begin
          </p>
        </div>
      )}
    </div>
  );
}
