import { useState } from "react";
import { Link } from "wouter";
import { Tag, Wrench, KeyRound, ChevronRight, FileDown, Loader2, BarChart3 } from "lucide-react";
import { useListPottery } from "@workspace/api-client-react";
import type { PotteryPotteryItem as PotteryItem } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const SETTINGS_ITEMS = [
  {
    href: "/categories",
    label: "Categories",
    description: "Manage piece categories and colours",
    icon: Tag,
  },
  {
    href: "/stats",
    label: "Collection Stats",
    description: "Charts and breakdowns of your collection",
    icon: BarChart3,
  },
  {
    href: "/maintenance",
    label: "Maintenance",
    description: "Bulk re-analyse pieces in the collection",
    icon: Wrench,
  },
  {
    href: "/account",
    label: "Account",
    description: "Change your sign-in password",
    icon: KeyRound,
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? "—"
    : dt.toLocaleDateString("en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Fetch one image as a data URL (uses session credentials). */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Pre-fetch all item images in parallel batches. */
async function prefetchImages(
  items: PotteryItem[],
  onProgress: (loaded: number, total: number) => void,
): Promise<(string | null)[]> {
  const results: (string | null)[] = new Array(items.length).fill(null);
  const BATCH = 8;
  let loaded = 0;

  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const fetched = await Promise.all(
      slice.map((item) =>
        item.imageUrl ? fetchAsDataUrl(item.imageUrl) : Promise.resolve(null),
      ),
    );
    fetched.forEach((dataUrl, j) => {
      results[i + j] = dataUrl;
    });
    loaded += slice.length;
    onProgress(Math.min(loaded, items.length), items.length);
  }

  return results;
}

// PDF page dimensions (A4 at 96dpi equivalent)
const PAGE_WIDTH_PX = 794; // ~A4 width at 96dpi
const ITEMS_PER_PAGE = 6; // safe chunk: 6 items × ~100px row ≈ 900px canvas height

/** Build a single-page DOM container for a chunk of items. */
function buildPageContainer(
  items: PotteryItem[],
  imageDataUrls: (string | null)[],
  pageNum: number,
  totalPages: number,
  exportDate: string,
  totalItems: number,
): HTMLDivElement {
  const container = document.createElement("div");
  container.style.cssText = [
    "position: absolute",
    "left: -9999px",
    "top: 0",
    `width: ${PAGE_WIDTH_PX}px`,
    "font-family: Georgia, 'Times New Roman', serif",
    "background: #fff",
    "color: #111",
    "padding: 32px 36px 24px",
    "box-sizing: border-box",
  ].join("; ");

  const header =
    pageNum === 1
      ? `<div style="margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #1f2937;">
           <div style="font-size:22px;font-weight:bold;margin-bottom:4px;">Pottery Collection</div>
           <div style="font-size:12px;color:#555;">Insurance &amp; Provenance Record — ${escHtml(exportDate)} — ${totalItems} piece${totalItems !== 1 ? "s" : ""}</div>
         </div>`
      : `<div style="margin-bottom:12px;font-size:10px;color:#aaa;">Pottery Collection — Insurance Record (continued)</div>`;

  const rows = items
    .map((item, i) => {
      const imgSrc = imageDataUrls[i];
      const imgTag = imgSrc
        ? `<img src="${imgSrc}" style="width:80px;height:80px;object-fit:cover;border-radius:5px;border:1px solid #ddd;display:block;" />`
        : `<div style="width:80px;height:80px;border-radius:5px;background:#f3f4f6;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:9px;color:#9ca3af;text-align:center;">No image</div>`;

      const fields = [
        item.maker
          ? `<span style="font-size:10.5px;"><b>Maker:</b> ${escHtml(item.maker)}</span>`
          : "",
        item.shape
          ? `<span style="font-size:10.5px;"><b>Shape:</b> ${escHtml(item.shape)}</span>`
          : "",
        item.style
          ? `<span style="font-size:10.5px;"><b>Style:</b> ${escHtml(item.style)}</span>`
          : "",
        item.dimensions
          ? `<span style="font-size:10.5px;"><b>Dimensions:</b> ${escHtml(item.dimensions)}</span>`
          : "",
        item.acquiredAt
          ? `<span style="font-size:10.5px;"><b>Acquired:</b> ${formatDate(item.acquiredAt)}</span>`
          : "",
        item.quantity && item.quantity > 1
          ? `<span style="font-size:10.5px;"><b>Qty:</b> ${item.quantity}</span>`
          : "",
        item.categories && item.categories.length > 0
          ? `<span style="font-size:10.5px;"><b>Categories:</b> ${item.categories.map((c) => escHtml(c.name)).join(", ")}</span>`
          : "",
        item.notes
          ? `<span style="font-size:9.5px;color:#666;font-style:italic;">${escHtml(item.notes)}</span>`
          : "",
      ]
        .filter(Boolean)
        .join(`<span style="color:#ddd;margin:0 4px;">·</span>`);

      return `
        <tr>
          <td style="padding:8px 6px;vertical-align:top;border-bottom:1px solid #eee;width:96px;">${imgTag}</td>
          <td style="padding:8px 10px;vertical-align:top;border-bottom:1px solid #eee;">
            <div style="font-size:12px;font-weight:bold;margin-bottom:5px;">${escHtml(item.name)}</div>
            <div style="line-height:1.8;">${fields}</div>
          </td>
        </tr>`;
    })
    .join("\n");

  const footer = `
    <div style="margin-top:14px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:9px;color:#aaa;display:flex;justify-content:space-between;">
      <span>Batchelor Pottery Collection</span>
      <span>Page ${pageNum} of ${totalPages}</span>
    </div>`;

  container.innerHTML = `
    ${header}
    <table style="width:100%;border-collapse:collapse;">
      <tbody>${rows}</tbody>
    </table>
    ${footer}`;

  return container;
}

/** Render a DOM container to a JPEG data URL via html2canvas. */
async function containerToJpeg(el: HTMLElement): Promise<string> {
  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: false,
    allowTaint: false,
    backgroundColor: "#ffffff",
    logging: false,
  });
  return canvas.toDataURL("image/jpeg", 0.90);
}

// ── Main PDF generator ────────────────────────────────────────────────────────

async function generateInsurancePdf(
  items: PotteryItem[],
  onProgress: (msg: string) => void,
): Promise<void> {
  const exportDate = formatDate(new Date().toISOString());

  // Phase 1: fetch images
  onProgress(`Loading images… 0 / ${items.length}`);
  const imageDataUrls = await prefetchImages(items, (loaded, total) => {
    onProgress(`Loading images… ${loaded} / ${total}`);
  });

  // Phase 2: paginate + rasterize per-page
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pageNum = pageIdx + 1;
    onProgress(`Rendering page ${pageNum} of ${totalPages}…`);

    const start = pageIdx * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, items.length);
    const pageItems = items.slice(start, end);
    const pageImages = imageDataUrls.slice(start, end);

    const container = buildPageContainer(
      pageItems,
      pageImages,
      pageNum,
      totalPages,
      exportDate,
      items.length,
    );
    document.body.appendChild(container);

    try {
      const jpeg = await containerToJpeg(container);

      if (pageIdx > 0) pdf.addPage();

      // Scale image to fill A4 page
      const tempCanvas = document.createElement("canvas");
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.src = jpeg;
      });
      tempCanvas.width = img.naturalWidth;
      tempCanvas.height = img.naturalHeight;

      const aspectRatio = img.naturalWidth / img.naturalHeight;
      const imgWmm = pdfW;
      const imgHmm = imgWmm / aspectRatio;
      // If content is shorter than page, just place it at top; if taller, scale to fit
      const finalH = Math.min(imgHmm, pdfH);
      const finalW = finalH * aspectRatio;
      const xOffset = (pdfW - finalW) / 2;

      pdf.addImage(jpeg, "JPEG", xOffset, 0, finalW, finalH);
    } finally {
      document.body.removeChild(container);
    }
  }

  onProgress("Saving PDF…");
  pdf.save("pottery-collection-insurance.pdf");
}

// ── Component ──────────────────────────────────────────────────────────────────

function InsuranceExportButton({ items }: { items: PotteryItem[] | undefined }) {
  const [progress, setProgress] = useState<string | null>(null);
  const generating = progress !== null;

  const handleExport = async () => {
    if (!items || items.length === 0) {
      toast.error("No items to export");
      return;
    }
    setProgress("Starting…");
    try {
      await generateInsurancePdf(items, setProgress);
      toast.success(`PDF downloaded — ${items.length} pieces`);
    } catch (err) {
      console.error("PDF export failed", err);
      toast.error("PDF generation failed. Try again.");
    } finally {
      setProgress(null);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleExport}
      disabled={generating || !items}
      className="w-full justify-start gap-3 h-auto px-5 py-4 rounded-none"
    >
      {generating ? (
        <Loader2 className="h-5 w-5 shrink-0 text-muted-foreground animate-spin" />
      ) : (
        <FileDown className="h-5 w-5 shrink-0 text-muted-foreground" />
      )}
      <div className="flex-1 text-left">
        <p className="font-medium">Export for insurance</p>
        <p className="text-sm text-muted-foreground">
          {generating ? progress : "Download a PDF with photos of every piece"}
        </p>
      </div>
    </Button>
  );
}

export default function Settings() {
  const { data: items } = useListPottery();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <ul className="mt-6 divide-y divide-card-border rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
        {SETTINGS_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
            >
              <item.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium">{item.label}</p>
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </li>
        ))}

        {/* Insurance export row */}
        <li>
          <InsuranceExportButton items={items} />
        </li>
      </ul>
    </div>
  );
}
