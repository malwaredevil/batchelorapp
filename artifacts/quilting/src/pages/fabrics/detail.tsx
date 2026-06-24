import { useState, useEffect } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  Trash2,
  Tag,
  Pencil,
  Lock,
  LockOpen,
  RefreshCw,
  Check,
  X as XIcon,
  Download,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getCategoryPalette } from "@workspace/web-core";
import { toast } from "sonner";
import {
  useGetFabric,
  useDeleteFabric,
  useUpdateFabric,
  useReanalyzeFabric,
  useListQuiltingCategories,
  getListFabricsQueryKey,
  getGetFabricQueryKey,
  type QuiltingCategory,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TagSelector } from "@/components/tag-selector";
import { PreviewZoomModal } from "@/components/PreviewZoomModal";
import { downloadCollectionImage } from "@/lib/svg-export";

type Fabric = {
  id: number;
  name: string;
  lineName?: string | null;
  designer?: string | null;
  manufacturer?: string | null;
  colorway?: string | null;
  printType?: string | null;
  fiberContent?: string | null;
  widthInches?: number | null;
  quantity: number;
  quantityUnit: string;
  sku?: string | null;
  notes?: string | null;
  aiDescription?: string | null;
  dominantColors: string[];
  motifs: string[];
  styleDescriptors: string[];
  acquiredAt?: string | null;
  lockedFields: string[];
  categories: Array<{
    id: number;
    name: string;
    bgColor: string | null;
    textColor: string | null;
  }>;
  imageUrl: string;
};

const AI_FIELDS: (keyof Fabric)[] = [
  "name",
  "lineName",
  "designer",
  "manufacturer",
  "colorway",
  "printType",
  "fiberContent",
  "dominantColors",
  "motifs",
  "styleDescriptors",
];

function LockButton({
  field,
  lockedFields,
  onToggle,
}: {
  field: string;
  lockedFields: string[];
  onToggle: (f: string) => void;
}) {
  const locked = lockedFields.includes(field);
  return (
    <button
      onClick={() => onToggle(field)}
      title={
        locked
          ? "AI will not change this — click to unlock"
          : "AI may update this — click to lock"
      }
      className={`ml-1 rounded p-0.5 transition-colors ${locked ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground/25 hover:text-muted-foreground/60"}`}
    >
      {locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
    </button>
  );
}

export default function FabricDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const fabricId = Number(id);

  const [isEditing, setIsEditing] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [catEditing, setCatEditing] = useState(false);
  const [localNewCats, setLocalNewCats] = useState<QuiltingCategory[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [renamingName, setRenamingName] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const rawSearch = useSearch();
  useEffect(() => {
    if (new URLSearchParams(rawSearch).get("edit") === "1") setIsEditing(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<{
    name: string;
    lineName: string;
    designer: string;
    manufacturer: string;
    colorway: string;
    printType: string;
    fiberContent: string;
    widthInches: string;
    quantity: string;
    quantityUnit: string;
    sku: string;
    notes: string;
    acquiredAt: string;
    dominantColors: string;
    motifs: string;
  }>({
    name: "",
    lineName: "",
    designer: "",
    manufacturer: "",
    colorway: "",
    printType: "",
    fiberContent: "",
    widthInches: "",
    quantity: "",
    quantityUnit: "",
    sku: "",
    notes: "",
    acquiredAt: "",
    dominantColors: "",
    motifs: "",
  });

  const { data: fabric, isLoading, isError } = useGetFabric(fabricId);
  const { data: allCategories } = useListQuiltingCategories();

  const deleteFabric = useDeleteFabric({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        queryClient.removeQueries({ queryKey: getGetFabricQueryKey(fabricId) });
        toast.success("Fabric deleted");
        navigate("/fabrics");
      },
      onError: () => toast.error("Failed to delete fabric."),
    },
  });

  const updateFabric = useUpdateFabric({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetFabricQueryKey(fabricId), data);
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        toast.success("Saved");
        setIsEditing(false);
      },
      onError: () => toast.error("Failed to save."),
    },
  });

  const reanalyzeFabric = useReanalyzeFabric({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetFabricQueryKey(fabricId), data);
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        toast.success("AI analysis refreshed");
      },
      onError: () => toast.error("Failed to refresh AI analysis."),
    },
  });

  function enterEdit() {
    if (!fabric) return;
    const f = fabric as unknown as Fabric;
    setDraft({
      name: f.name,
      lineName: f.lineName ?? "",
      designer: f.designer ?? "",
      manufacturer: f.manufacturer ?? "",
      colorway: f.colorway ?? "",
      printType: f.printType ?? "",
      fiberContent: f.fiberContent ?? "",
      widthInches: f.widthInches != null ? String(f.widthInches) : "",
      quantity: String(f.quantity),
      quantityUnit: f.quantityUnit,
      sku: f.sku ?? "",
      notes: f.notes ?? "",
      acquiredAt: f.acquiredAt ?? "",
      dominantColors: f.dominantColors.join(", "),
      motifs: f.motifs.join(", "),
    });
    setSelectedCategoryIds(f.categories.map((c) => c.id));
    setIsEditing(true);
  }

  function handleSave() {
    const categoryNames = (allCategories ?? [])
      .filter((c) => selectedCategoryIds.includes(c.id))
      .map((c) => c.name);
    updateFabric.mutate({
      id: fabricId,
      data: {
        name: draft.name || undefined,
        lineName: draft.lineName || null,
        designer: draft.designer || null,
        manufacturer: draft.manufacturer || null,
        colorway: draft.colorway || null,
        printType: draft.printType || null,
        fiberContent: draft.fiberContent || null,
        widthInches: draft.widthInches
          ? parseFloat(draft.widthInches) || null
          : null,
        quantity: draft.quantity
          ? parseFloat(draft.quantity) || undefined
          : undefined,
        quantityUnit: draft.quantityUnit || undefined,
        sku: draft.sku || null,
        notes: draft.notes || null,
        acquiredAt: draft.acquiredAt || null,
        dominantColors: draft.dominantColors
          ? draft.dominantColors
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        motifs: draft.motifs
          ? draft.motifs
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        categories: categoryNames,
      },
    });
  }

  function toggleLock(field: string) {
    if (!fabric) return;
    const f = fabric as unknown as Fabric;
    const current = f.lockedFields ?? [];
    const next = current.includes(field)
      ? current.filter((x) => x !== field)
      : [...current, field];
    updateFabric.mutate({ id: fabricId, data: { lockedFields: next } });
    toast.success(
      next.includes(field)
        ? `"${field}" locked — AI won't change this`
        : `"${field}" unlocked`,
    );
  }

  function handleRefreshAI() {
    reanalyzeFabric.mutate({ id: fabricId });
    toast.info("Refreshing AI analysis…");
  }

  function handleRename() {
    if (!renameValue.trim()) return;
    updateFabric.mutate(
      { id: fabricId, data: { name: renameValue.trim() } },
      { onSuccess: () => setRenamingName(false) },
    );
  }

  function enterCatEdit() {
    const f = fabric as unknown as Fabric;
    setSelectedCategoryIds(f.categories?.map((c) => c.id) ?? []);
    setLocalNewCats([]);
    setCatEditing(true);
  }

  function handleSaveCategories() {
    const merged = [
      ...(allCategories ?? []),
      ...localNewCats.filter((nc) => !(allCategories ?? []).some((a) => a.id === nc.id)),
    ];
    const categoryNames = merged
      .filter((c) => selectedCategoryIds.includes(c.id))
      .map((c) => c.name);
    updateFabric.mutate(
      { id: fabricId, data: { categories: categoryNames } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetFabricQueryKey(fabricId), data);
          queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
          toast.success("Categories saved");
          setCatEditing(false);
        },
        onError: () => toast.error("Failed to save categories"),
      },
    );
  }

  if (isLoading) {
    return (
      <div>
        <div className="mb-6 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/fabrics")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <div className="space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !fabric) {
    return (
      <div className="flex h-60 flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Fabric not found.</p>
        <Button variant="outline" onClick={() => navigate("/fabrics")}>
          Back to collection
        </Button>
      </div>
    );
  }

  const f = fabric as unknown as Fabric;
  const lockedFields = f.lockedFields ?? [];
  const field = (k: keyof typeof draft) => draft[k];
  const set = (k: keyof typeof draft, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="mx-auto max-w-3xl">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 -ml-2"
        onClick={() => navigate("/fabrics")}
      >
        <ArrowLeft className="h-4 w-4" />
        Fabrics
      </Button>

      <div className="grid gap-6 md:grid-cols-2">
        <div
          className="relative overflow-hidden rounded-2xl border border-card-border bg-muted cursor-zoom-in group"
          onClick={() => setLightboxOpen(true)}
        >
          <img
            src={f.imageUrl}
            alt={f.name}
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
            <ZoomIn className="h-10 w-10 text-white drop-shadow-lg" />
          </div>
        </div>
        <PreviewZoomModal
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          title={f.name}
        >
          <img
            src={f.imageUrl}
            alt={f.name}
            className="max-h-[85vh] max-w-[85vw] rounded object-contain"
            draggable={false}
          />
        </PreviewZoomModal>

        <div className="flex flex-col gap-4">
          {/* Title row */}
          {renamingName ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="h-9 flex-1 text-lg font-semibold"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") setRenamingName(false);
                }}
                autoFocus
              />
              <Button size="sm" onClick={handleRename} disabled={updateFabric.isPending}>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Save
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRenamingName(false)}>
                <XIcon className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <h1 className="flex-1 text-2xl font-bold tracking-tight leading-tight">
                {isEditing ? draft.name || f.name : f.name}
              </h1>
              <div className="flex shrink-0 gap-1">
                {isEditing ? (
                  <>
                    <Button size="sm" onClick={handleSave} disabled={updateFabric.isPending}>
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      Save
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setIsEditing(false)}>
                      <XIcon className="mr-1.5 h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleRefreshAI}
                      disabled={reanalyzeFabric.isPending}
                      title="Re-run AI analysis on this fabric's photo"
                    >
                      <RefreshCw className={`h-4 w-4 ${reanalyzeFabric.isPending ? "animate-spin" : ""}`} />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleLock("name")}
                      disabled={updateFabric.isPending}
                      title={lockedFields.includes("name") ? "Name is locked — click to unlock." : "Name is unlocked — click to lock."}
                      className={lockedFields.includes("name") ? "border-red-400 text-red-600 hover:border-red-500 hover:text-red-700" : "border-green-400 text-green-600 hover:border-green-500 hover:text-green-700"}
                    >
                      {lockedFields.includes("name") ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={enterEdit}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      title="Download photo"
                      onClick={() => downloadCollectionImage(f.imageUrl, f.name)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => { if (confirm("Delete this fabric? This cannot be undone.")) deleteFabric.mutate({ id: fabricId }); }}
                      disabled={deleteFabric.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
          {/* Inventory */}
          <section className="rounded-xl border border-card-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Inventory
            </p>
            {isEditing ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Quantity
                  </label>
                  <Input
                    value={field("quantity")}
                    onChange={(e) => set("quantity", e.target.value)}
                    type="number"
                    min="0"
                    step="0.25"
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Unit
                  </label>
                  <Input
                    value={field("quantityUnit")}
                    onChange={(e) => set("quantityUnit", e.target.value)}
                    className="h-8 text-sm"
                    placeholder="yards"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Width (inches)
                  </label>
                  <Input
                    value={field("widthInches")}
                    onChange={(e) => set("widthInches", e.target.value)}
                    type="number"
                    min="0"
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    SKU
                  </label>
                  <Input
                    value={field("sku")}
                    onChange={(e) => set("sku", e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Acquired
                  </label>
                  <Input
                    value={field("acquiredAt")}
                    onChange={(e) => set("acquiredAt", e.target.value)}
                    className="h-8 text-sm"
                    placeholder="2024-01"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Quantity</span>
                  <p className="font-semibold">
                    {f.quantity} {f.quantityUnit}
                  </p>
                </div>
                {f.widthInches != null && (
                  <div>
                    <span className="text-muted-foreground">Width</span>
                    <p className="font-semibold">{f.widthInches}"</p>
                  </div>
                )}
                {f.sku && (
                  <div>
                    <span className="text-muted-foreground">SKU</span>
                    <p className="font-mono font-semibold">{f.sku}</p>
                  </div>
                )}
                {f.acquiredAt && (
                  <div>
                    <span className="text-muted-foreground">Acquired</span>
                    <p className="font-semibold">{f.acquiredAt}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Fabric details */}
          <section className="rounded-xl border border-card-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Fabric details
            </p>
            {isEditing ? (
              <div className="space-y-2">
                {(
                  [
                    "name",
                    "lineName",
                    "designer",
                    "manufacturer",
                    "colorway",
                    "printType",
                    "fiberContent",
                  ] as const
                ).map((k) => {
                  const labels: Record<string, string> = {
                    name: "Name",
                    lineName: "Line name",
                    designer: "Designer",
                    manufacturer: "Manufacturer",
                    colorway: "Colorway",
                    printType: "Print type",
                    fiberContent: "Fibre content",
                  };
                  const isAI = AI_FIELDS.includes(k as keyof Fabric);
                  return (
                    <div key={k}>
                      <label className="mb-1 flex items-center text-xs text-muted-foreground">
                        {labels[k]}
                        {isAI && (
                          <LockButton
                            field={k}
                            lockedFields={lockedFields}
                            onToggle={toggleLock}
                          />
                        )}
                      </label>
                      <Input
                        value={field(k)}
                        onChange={(e) => set(k, e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                {(
                  [
                    ["lineName", "Line", f.lineName],
                    ["designer", "Designer", f.designer],
                    ["manufacturer", "Manufacturer", f.manufacturer],
                    ["colorway", "Colorway", f.colorway],
                    ["printType", "Print type", f.printType],
                    ["fiberContent", "Fibre", f.fiberContent],
                  ] as [string, string, string | null | undefined][]
                )
                  .filter(([, , v]) => v)
                  .map(([k, label, v]) => (
                    <div key={k} className="flex items-center justify-between">
                      <span className="flex items-center gap-0.5 text-muted-foreground">
                        {label}
                        <LockButton
                          field={k}
                          lockedFields={lockedFields}
                          onToggle={toggleLock}
                        />
                      </span>
                      <span className="font-medium capitalize">{v}</span>
                    </div>
                  ))}
              </div>
            )}
          </section>

          {/* Colors / Motifs */}
          <section className="rounded-xl border border-card-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Characteristics
            </p>
            {isEditing ? (
              <div className="space-y-2">
                <div>
                  <label className="mb-1 flex items-center text-xs text-muted-foreground">
                    Dominant colours
                    <LockButton
                      field="dominantColors"
                      lockedFields={lockedFields}
                      onToggle={toggleLock}
                    />
                  </label>
                  <Input
                    value={field("dominantColors")}
                    onChange={(e) => set("dominantColors", e.target.value)}
                    placeholder="red, blue, gold"
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center text-xs text-muted-foreground">
                    Motifs
                    <LockButton
                      field="motifs"
                      lockedFields={lockedFields}
                      onToggle={toggleLock}
                    />
                  </label>
                  <Input
                    value={field("motifs")}
                    onChange={(e) => set("motifs", e.target.value)}
                    placeholder="floral, leaves"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            ) : (
              <>
                {f.dominantColors.length > 0 && (
                  <div className="mb-2">
                    <p className="mb-1.5 flex items-center gap-0.5 text-xs text-muted-foreground">
                      Colours
                      <LockButton
                        field="dominantColors"
                        lockedFields={lockedFields}
                        onToggle={toggleLock}
                      />
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {f.dominantColors.map((c) => (
                        <Badge
                          key={c}
                          variant="secondary"
                          className="capitalize"
                        >
                          {c}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {f.motifs.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-0.5 text-xs text-muted-foreground">
                      Motifs
                      <LockButton
                        field="motifs"
                        lockedFields={lockedFields}
                        onToggle={toggleLock}
                      />
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {f.motifs.map((m) => (
                        <Badge key={m} variant="outline" className="capitalize">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {f.dominantColors.length === 0 && f.motifs.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">
                    No characteristics catalogued yet
                  </p>
                )}
              </>
            )}
          </section>

          {/* Categories */}
          <section className="rounded-xl border border-card-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Tag className="h-3 w-3" /> Categories
              </p>
              {!catEditing && !isEditing && (
                <button
                  onClick={enterCatEdit}
                  className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                  title="Edit categories"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
            {isEditing ? (
              <TagSelector
                allCategories={allCategories ?? []}
                selectedIds={selectedCategoryIds}
                onToggle={(id) =>
                  setSelectedCategoryIds((prev) =>
                    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                  )
                }
                onCreated={(cat) =>
                  setSelectedCategoryIds((prev) => [...prev, cat.id])
                }
                disabled={updateFabric.isPending}
              />
            ) : catEditing ? (
              <>
                <TagSelector
                  allCategories={allCategories ?? []}
                  selectedIds={selectedCategoryIds}
                  onToggle={(id) =>
                    setSelectedCategoryIds((prev) =>
                      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                    )
                  }
                  onCreated={(cat) => {
                    setSelectedCategoryIds((prev) => [...prev, cat.id]);
                    setLocalNewCats((prev) =>
                      prev.some((c) => c.id === cat.id) ? prev : [...prev, cat],
                    );
                  }}
                  disabled={updateFabric.isPending}
                />
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={handleSaveCategories} disabled={updateFabric.isPending}>
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    {updateFabric.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCatEditing(false)} disabled={updateFabric.isPending}>
                    <XIcon className="mr-1.5 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
              </>
            ) : f.categories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {f.categories.map((cat) => (
                  <Badge
                    key={cat.id}
                    variant="outline"
                    className="border-transparent"
                    style={(() => {
                      const palette = cat.bgColor
                        ? { bgColor: cat.bgColor, textColor: cat.textColor ?? "#fff" }
                        : getCategoryPalette(cat.name);
                      return { backgroundColor: palette.bgColor, color: palette.textColor };
                    })()}
                  >
                    {cat.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground">
                No categories — click <Pencil className="inline h-2.5 w-2.5" /> to add
              </p>
            )}
          </section>

          {/* AI description */}
          {f.aiDescription && (
            <section className="rounded-xl border border-card-border bg-card p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                AI description
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {f.aiDescription}
              </p>
            </section>
          )}

          {/* Notes */}
          <section className="rounded-xl border border-card-border bg-card p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notes
            </p>
            {isEditing ? (
              <Textarea
                value={field("notes")}
                onChange={(e) => set("notes", e.target.value)}
                rows={4}
                className="text-sm"
                placeholder="Any notes about this fabric…"
              />
            ) : f.notes ? (
              <p className="text-sm leading-relaxed">{f.notes}</p>
            ) : (
              <p className="text-xs text-muted-foreground italic">No notes</p>
            )}
          </section>

          {/* Lock hint */}
          {!isEditing && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground/60">
              <LockOpen className="h-3 w-3" />
              Tap a lock icon to protect a field from AI updates.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
