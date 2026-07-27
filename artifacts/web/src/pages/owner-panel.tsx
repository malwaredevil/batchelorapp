import { useState, useRef, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  ArrowLeft,
  Code2,
  Globe,
  Map,
  Settings2,
  Puzzle,
  FlaskConical,
} from "lucide-react";
import { GlobalConfigCard } from "@workspace/elaine-ui";
import {
  ReminderEmailCard,
  TimezoneCard,
  GmailSyncCard,
  CalendarSyncCard,
} from "@workspace/travels-settings-ui";
import { AppLogo } from "@/components/app-logo";
import { useAuth } from "@/lib/auth";
import { usePageAssistantContext } from "@/lib/assistant-context";
import { ControlPanelContent } from "@/pages/control-panel";
import { GoogleApisDemoContent } from "@/pages/google-apis-demo";
import { ServicesCatalogContent } from "@/pages/services-catalog";

type Tab =
  | "travels"
  | "global-config"
  | "control-panel"
  | "google-apis"
  | "services"
  | "ai-evidence"
  | "ai-lab";

const ALL_TABS: { id: Tab; label: string; icon: typeof Globe }[] = [
  { id: "travels", label: "Travels", icon: Globe },
  { id: "global-config", label: "Global Config", icon: Settings2 },
  { id: "control-panel", label: "Control Panel", icon: Code2 },
  { id: "google-apis", label: "Google APIs", icon: Map },
  { id: "services", label: "Services", icon: Puzzle },
  { id: "ai-evidence", label: "AI Evidence", icon: FlaskConical },
  { id: "ai-lab", label: "AI Lab", icon: FlaskConical },
];

export default function OwnerPanel() {
  const { user } = useAuth();
  const isOwner = !!user?.isOwner;

  const visibleTabs = isOwner
    ? ALL_TABS
    : ALL_TABS.filter((t) => t.id === "travels");

  const [activeTab, setActiveTab] = useState<Tab>("travels");
  const safeTab: Tab = visibleTabs.some((t) => t.id === activeTab)
    ? activeTab
    : "travels";

  usePageAssistantContext(
    "hub-owner-panel",
    `On the Owner Panel page (Travels app settings, Global Configuration, Control Panel, and Google APIs demo). Signed in as ${user?.email ?? "unknown"}${isOwner ? " (owner)" : ""}.`,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-6 py-4 backdrop-blur-md">
        <Link
          href="/account"
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to account
        </Link>
        <div className="flex items-center gap-2">
          <AppLogo className="h-7 w-7" />
          <span className="font-semibold tracking-tight text-primary">
            Batchelor
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Owner Panel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isOwner
              ? "App settings, AI configuration, runtime tuning, and developer tools."
              : "App settings for the Travels module."}
          </p>
        </div>

        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const active = safeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {safeTab === "travels" && (
          <div className="mx-auto w-full max-w-xl space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Travels</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reminder emails, timezone, Gmail scanning, and Google Calendar
                connections for the Travels app.
              </p>
            </div>
            <div className="space-y-6">
              <ReminderEmailCard />
              <TimezoneCard />
              <GmailSyncCard usePageContext={usePageAssistantContext} />
              <CalendarSyncCard usePageContext={usePageAssistantContext} />
            </div>
          </div>
        )}

        {safeTab === "global-config" && isOwner && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Global Configuration
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                AI models, timeouts, feature toggles, and thresholds.
              </p>
            </div>
            <GlobalConfigCard />
          </div>
        )}

        {safeTab === "control-panel" && isOwner && <ControlPanelContent />}

        {safeTab === "google-apis" && isOwner && <GoogleApisDemoContent />}

        {safeTab === "services" && isOwner && <ServicesCatalogContent />}

        {safeTab === "ai-evidence" && isOwner && <AiEvidenceContent />}

        {safeTab === "ai-lab" && isOwner && <AiLabContent />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Evidence — owner-only tab showing AI generation run statistics.
// Helps the owner diagnose why AI picked certain field values and track
// model quality over time. Never shown in regular user UI.
// ---------------------------------------------------------------------------

interface AiEvidenceSummaryRow {
  module: string;
  feature: string;
  model: string;
  run_count: number;
  success_count: number;
  avg_duration_ms: number | null;
  total_candidates: number;
  accepted_candidates: number;
  rejected_candidates: number;
}

function AiEvidenceContent() {
  const [summary, setSummary] = useState<AiEvidenceSummaryRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    // raw-fetch-ok — owner-only admin panel; no generated hook for this endpoint
    fetch("/api/ai-evidence/summary")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<{ summary: AiEvidenceSummaryRow[] }>;
      })
      .then((d) => setSummary(d.summary))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  };

  useState(() => {
    load();
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">AI Evidence</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Generation run statistics by module and feature. Use this to
            diagnose wrong AI values and track model quality over time.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && summary !== null && summary.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No generation runs recorded yet. AI runs will appear here after items
          are analysed.
        </p>
      )}

      {!loading && !error && summary && summary.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">
                  Module
                </th>
                <th className="px-3 py-2 font-medium text-muted-foreground">
                  Feature
                </th>
                <th className="px-3 py-2 font-medium text-muted-foreground">
                  Model
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Runs
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Success %
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Avg ms
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Candidates
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Accepted
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Rejected
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row, i) => {
                const successPct =
                  row.run_count > 0
                    ? Math.round((row.success_count / row.run_count) * 100)
                    : 0;
                return (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-3 py-2 font-medium capitalize">
                      {row.module}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.feature}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {row.model.split("/").pop()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.run_count}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${successPct < 80 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}
                    >
                      {successPct}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {row.avg_duration_ms != null
                        ? row.avg_duration_ms.toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.total_candidates}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-600 dark:text-green-400">
                      {row.accepted_candidates}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">
                      {row.rejected_candidates}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Lab — owner-only tab for testing fabric crease / fold removal.
// Lets the owner compare OpenAI gpt-image-1 vs Replicate FLUX Fill on a
// fabric photo side-by-side before rolling either technique into the quilting
// module. Only visible when isOwner === true.
// ---------------------------------------------------------------------------

interface LabFabric {
  id: number;
  name: string;
}

interface InpaintResult {
  dataUrl?: string;
  error?: string;
}

const CANVAS_MAX_PX = 520;

function AiLabContent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Fabric picker ──────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [fabricList, setFabricList] = useState<LabFabric[]>([]);
  const [selectedFabric, setSelectedFabric] = useState<LabFabric | null>(null);

  // ── Test photo (optional override for the source image) ────────────────
  const [testPhotoDataUrl, setTestPhotoDataUrl] = useState<string | null>(null);
  const [testPhotoName, setTestPhotoName] = useState<string | null>(null);

  // ── Canvas state ───────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [canvasW, setCanvasW] = useState(CANVAS_MAX_PX);
  const [canvasH, setCanvasH] = useState(CANVAS_MAX_PX);
  const [brushSize, setBrushSize] = useState(24);
  const isDrawingRef = useRef(false);

  // ── Detection / removal ────────────────────────────────────────────────
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  // Per-panel loading states so each resolves independently
  const [openaiRemoving, setOpenaiRemoving] = useState(false);
  const [replicateRemoving, setReplicateRemoving] = useState(false);
  const [openaiResult, setOpenaiResult] = useState<InpaintResult | null>(null);
  const [replicateResult, setReplicateResult] = useState<InpaintResult | null>(
    null,
  );
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});

  // ── Load fabrics on mount + when query changes ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    const url = `/api/quilting/fabrics?pageSize=50${query ? `&q=${encodeURIComponent(query)}` : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((d: { items?: LabFabric[] }) => {
        if (!cancelled) setFabricList(d.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [query]);

  // ── Handle fresh test photo upload ────────────────────────────────────
  const handleTestPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setTestPhotoDataUrl(dataUrl);
      setTestPhotoName(file.name);
      setOpenaiResult(null);
      setReplicateResult(null);
      setDetectMsg(null);
      setSaveStatus({});
    };
    reader.readAsDataURL(file);
  };

  // ── Resize canvas when image loads ────────────────────────────────────
  const handleImageLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const nw = img.naturalWidth || CANVAS_MAX_PX;
    const nh = img.naturalHeight || CANVAS_MAX_PX;
    const scale = Math.min(1, CANVAS_MAX_PX / Math.max(nw, nh));
    const w = Math.round(nw * scale);
    const h = Math.round(nh * scale);
    setCanvasW(w);
    setCanvasH(h);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, w, h);
    setDetectMsg(null);
    setOpenaiResult(null);
    setReplicateResult(null);
    setSaveStatus({});
  }, []);

  // ── Canvas drawing ────────────────────────────────────────────────────
  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      if (!t) return { x: 0, y: 0 };
      return {
        x: (t.clientX - rect.left) * scaleX,
        y: (t.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const paintAt = (pos: { x: number; y: number }) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "rgba(139, 92, 246, 0.65)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const onMouseDown = (e: React.MouseEvent) => {
    isDrawingRef.current = true;
    paintAt(getCanvasPos(e));
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (isDrawingRef.current) paintAt(getCanvasPos(e));
  };
  const onMouseUp = () => {
    isDrawingRef.current = false;
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvasW, canvasH);
    setDetectMsg(null);
  };

  // Build white-on-transparent mask for the server
  const getMaskDataUrl = (): string => {
    const src = canvasRef.current;
    if (!src) return "";
    const off = document.createElement("canvas");
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const imgd = ctx.getImageData(0, 0, off.width, off.height);
    const d = imgd.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 10) {
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(imgd, 0, 0);
    return off.toDataURL("image/png");
  };

  // ── Detect creases ────────────────────────────────────────────────────
  const detectCreases = async () => {
    if (!selectedFabric && !testPhotoDataUrl) return;
    setDetecting(true);
    setDetectMsg(null);
    try {
      const body = testPhotoDataUrl
        ? { sourceDataUrl: testPhotoDataUrl }
        : { fabricId: selectedFabric!.id };
      // raw-fetch-ok — owner-only AI lab; no generated hook for this endpoint
      const resp = await fetch("/api/quilting/lab/detect-creases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as {
        description?: string;
        maskDataUrl?: string;
        creasesFound?: number;
        error?: string;
      };
      if (!resp.ok || data.error) {
        setDetectMsg(`Detection failed: ${data.error ?? "unknown error"}`);
        return;
      }
      const found = data.creasesFound ?? 0;
      setDetectMsg(
        found === 0
          ? "No creases detected — paint the mask manually if needed."
          : `Detected ${found} crease${found === 1 ? "" : "s"}: ${data.description ?? ""}`,
      );
      if (data.maskDataUrl) {
        const maskImg = new Image();
        maskImg.onload = () => {
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          ctx.clearRect(0, 0, canvasW, canvasH);
          // Draw mask scaled to canvas, then re-colour to purple
          const tmp = document.createElement("canvas");
          tmp.width = canvasW;
          tmp.height = canvasH;
          const tc = tmp.getContext("2d")!;
          tc.drawImage(maskImg, 0, 0, canvasW, canvasH);
          const id = tc.getImageData(0, 0, canvasW, canvasH);
          const pd = id.data;
          for (let i = 0; i < pd.length; i += 4) {
            if (pd[i + 3] > 10) {
              pd[i] = 139;
              pd[i + 1] = 92;
              pd[i + 2] = 246;
              pd[i + 3] = 180;
            }
          }
          tc.putImageData(id, 0, 0);
          ctx.drawImage(tmp, 0, 0);
        };
        maskImg.src = data.maskDataUrl;
      }
    } catch {
      setDetectMsg("Detection request failed — check server logs.");
    } finally {
      setDetecting(false);
    }
  };

  // ── Remove creases — calls both provider endpoints in parallel so each
  //    result panel resolves independently as soon as its model finishes. ──
  const removeCreases = () => {
    if (!selectedFabric && !testPhotoDataUrl) return;
    const maskDataUrl = getMaskDataUrl();
    if (!maskDataUrl) return;

    setOpenaiResult(null);
    setReplicateResult(null);
    setSaveStatus({});

    const sourceBody = testPhotoDataUrl
      ? { sourceDataUrl: testPhotoDataUrl }
      : { fabricId: selectedFabric!.id };

    // OpenAI — resolves independently
    setOpenaiRemoving(true);
    // raw-fetch-ok — owner-only AI lab; no generated hook for this endpoint
    fetch("/api/quilting/lab/remove-creases/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sourceBody, maskDataUrl }),
    })
      .then(async (resp) => {
        const data = (await resp.json()) as {
          dataUrl?: string;
          error?: string;
        };
        setOpenaiResult(
          resp.ok && data.dataUrl
            ? { dataUrl: data.dataUrl }
            : { error: data.error ?? "OpenAI returned no result." },
        );
      })
      .catch(() =>
        setOpenaiResult({
          error: "OpenAI request failed — check server logs.",
        }),
      )
      .finally(() => setOpenaiRemoving(false));

    // Replicate — resolves independently
    setReplicateRemoving(true);
    // raw-fetch-ok — owner-only AI lab; no generated hook for this endpoint
    fetch("/api/quilting/lab/remove-creases/replicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sourceBody, maskDataUrl }),
    })
      .then(async (resp) => {
        const data = (await resp.json()) as {
          dataUrl?: string;
          error?: string;
        };
        setReplicateResult(
          resp.ok && data.dataUrl
            ? { dataUrl: data.dataUrl }
            : { error: data.error ?? "Replicate returned no result." },
        );
      })
      .catch(() =>
        setReplicateResult({
          error: "Replicate request failed — check server logs.",
        }),
      )
      .finally(() => setReplicateRemoving(false));
  };

  // ── Save result as fabric primary photo ───────────────────────────────
  const saveResult = async (dataUrl: string, key: string) => {
    if (!selectedFabric) return;
    setSaveStatus((s) => ({ ...s, [key]: "saving" }));
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const form = new FormData();
      form.append("image", blob, "inpainted.png");
      // raw-fetch-ok — owner-only AI lab; no generated hook for this endpoint
      const resp = await fetch(
        `/api/quilting/fabrics/${selectedFabric.id}/image`,
        {
          method: "PUT",
          body: form,
        },
      );
      if (!resp.ok) throw new Error(`${resp.status}`);
      setSaveStatus((s) => ({ ...s, [key]: "saved" }));
      // Invalidate the fabric cache so detail pages pick up the new image
      await queryClient.invalidateQueries({
        queryKey: ["quilting", "fabrics", selectedFabric.id],
      });
      toast({
        title: "Photo saved",
        description: `${selectedFabric.name || `Fabric #${selectedFabric.id}`} primary photo updated.`,
      });
    } catch {
      setSaveStatus((s) => ({ ...s, [key]: "error" }));
      toast({
        title: "Save failed",
        description: "Could not update the fabric photo. Check server logs.",
        variant: "destructive",
      });
    }
  };

  // Source image: prefer the uploaded test photo, fall back to the saved fabric image
  const sourceImageUrl = testPhotoDataUrl
    ? testPhotoDataUrl
    : selectedFabric
      ? `/api/quilting/fabrics/${selectedFabric.id}/image`
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          AI Lab — Crease Removal
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a fabric, auto-detect or paint over creases, then run both AI
          models in parallel. Save whichever result you prefer as the fabric's
          primary photo.
        </p>
      </div>

      {/* Fabric picker + optional test photo upload */}
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Fabric (from collection)
          </label>
          <input
            type="search"
            placeholder="Search fabrics…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-background">
            {fabricList.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                No fabrics found.
              </p>
            )}
            {fabricList.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setSelectedFabric(f);
                  setTestPhotoDataUrl(null);
                  setTestPhotoName(null);
                  setOpenaiResult(null);
                  setReplicateResult(null);
                  setDetectMsg(null);
                  setSaveStatus({});
                }}
                className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                  selectedFabric?.id === f.id && !testPhotoDataUrl
                    ? "bg-primary/10 font-medium"
                    : ""
                }`}
              >
                {f.name || `Fabric #${f.id}`}
              </button>
            ))}
          </div>
        </div>

        {/* OR: upload a fresh test photo that isn't yet in the collection */}
        <div className="space-y-1">
          <label className="text-sm font-medium">
            Or upload a test photo{" "}
            <span className="font-normal text-muted-foreground">
              (not saved to collection)
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted">
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleTestPhotoUpload}
            />
            {testPhotoName ? (
              <span className="truncate text-foreground">{testPhotoName}</span>
            ) : (
              <span>Choose image…</span>
            )}
          </label>
          {testPhotoDataUrl && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Using uploaded test photo. Detect/Remove will use this image.{" "}
              {!selectedFabric && (
                <span>Select a fabric above to enable Save.</span>
              )}
            </p>
          )}
        </div>
      </div>

      {(selectedFabric || testPhotoDataUrl) && sourceImageUrl && (
        <>
          {/* Canvas editor */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {selectedFabric
                  ? selectedFabric.name || `Fabric #${selectedFabric.id}`
                  : (testPhotoName ?? "Test photo")}
              </span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  Brush
                  <input
                    type="range"
                    min={8}
                    max={80}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-20"
                  />
                  <span className="tabular-nums">{brushSize}px</span>
                </label>
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  Clear
                </button>
              </div>
            </div>
            <div
              className="relative select-none overflow-hidden rounded-md border border-border bg-muted"
              style={{ width: canvasW, height: canvasH, maxWidth: "100%" }}
            >
              <img
                ref={imgRef}
                src={sourceImageUrl}
                alt={selectedFabric?.name ?? "Test photo"}
                onLoad={handleImageLoad}
                className="absolute inset-0 h-full w-full object-contain"
                draggable={false}
              />
              <canvas
                ref={canvasRef}
                width={canvasW}
                height={canvasH}
                className="absolute inset-0 cursor-crosshair"
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Purple highlights = areas to inpaint. Paint over creases, or use{" "}
              <strong>Auto-detect</strong> first.
            </p>
            {detectMsg && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm">
                {detectMsg}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={detectCreases}
              disabled={detecting || openaiRemoving || replicateRemoving}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {detecting ? "Detecting…" : "Auto-detect creases"}
            </button>
            <button
              type="button"
              onClick={removeCreases}
              disabled={openaiRemoving || replicateRemoving || detecting}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {openaiRemoving || replicateRemoving
                ? "Running AI (30–60 s)…"
                : "Remove creases"}
            </button>
          </div>

          {/* Results */}
          {(openaiRemoving ||
            replicateRemoving ||
            openaiResult ||
            replicateResult) && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Side-by-side comparison</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {/* Original */}
                <div className="space-y-1">
                  <p className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Original
                  </p>
                  <img
                    src={sourceImageUrl}
                    alt="Original"
                    className="w-full rounded-md border border-border object-cover"
                  />
                </div>

                <LabResultPanel
                  label="OpenAI gpt-image-1"
                  loading={openaiRemoving}
                  result={openaiResult}
                  saveDisabled={!selectedFabric}
                  saveStatus={saveStatus["openai"]}
                  onSave={() => {
                    if (openaiResult?.dataUrl)
                      saveResult(openaiResult.dataUrl, "openai");
                  }}
                />

                <LabResultPanel
                  label="Replicate FLUX Fill"
                  loading={replicateRemoving}
                  result={replicateResult}
                  saveDisabled={!selectedFabric}
                  saveStatus={saveStatus["replicate"]}
                  onSave={() => {
                    if (replicateResult?.dataUrl)
                      saveResult(replicateResult.dataUrl, "replicate");
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LabResultPanel({
  label,
  loading,
  result,
  saveStatus,
  saveDisabled,
  onSave,
}: {
  label: string;
  loading: boolean;
  result: InpaintResult | null;
  saveStatus?: string;
  saveDisabled?: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {loading && (
        <div className="flex h-32 items-center justify-center rounded-md border border-border bg-muted">
          <p className="animate-pulse text-xs text-muted-foreground">
            Running…
          </p>
        </div>
      )}
      {result?.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {result.error}
        </div>
      )}
      {result?.dataUrl && (
        <>
          <img
            src={result.dataUrl}
            alt={label}
            className="w-full rounded-md border border-border object-cover"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={!!saveStatus || saveDisabled}
            title={saveDisabled ? "Select a fabric above to save" : undefined}
            className="w-full rounded-md bg-green-600 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "saved"
                ? "✓ Saved as primary photo"
                : saveStatus === "error"
                  ? "Save failed — try again"
                  : saveDisabled
                    ? "Select a fabric to save"
                    : "Save as primary photo"}
          </button>
        </>
      )}
    </div>
  );
}
