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

/** Fetch an image URL and return a data URL, or null on failure. */
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

/** Fetch images in parallel batches; returns array indexed by item position. */
async function prefetchImages(
  items: PotteryItem[],
  onProgress: (loaded: number, total: number) => void,
): Promise<(string | null)[]> {
  const results: (string | null)[] = new Array(items.length).fill(null);
  const BATCH = 10;
  let loaded = 0;

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const fetched = await Promise.all(
      batch.map((item) => (item.imageUrl ? fetchAsDataUrl(item.imageUrl) : Promise.resolve(null))),
    );
    fetched.forEach((dataUrl, j) => {
      results[i + j] = dataUrl;
    });
    loaded += batch.length;
    onProgress(Math.min(loaded, items.length), items.length);
  }

  return results;
}

/** Build a print-layout DOM container from items + pre-fetched image data URLs. */
function buildPrintContainer(
  items: PotteryItem[],
  imageDataUrls: (string | null)[],
): HTMLDivElement {
  const container = document.createElement("div");
  container.style.cssText = [
    "position: absolute",
    "left: -9999px",
    "top: -9999px",
    "width: 794px",
    "font-family: Georgia, 'Times New Roman', serif",
    "background: #fff",
    "color: #111",
    "padding: 40px 40px 20px",
    "box-sizing: border-box",
  ].join("; ");

  const coverDate = formatDate(new Date().toISOString());

  const rows = items
    .map((item, i) => {
      const imgSrc = imageDataUrls[i];
      const imgTag = imgSrc
        ? `<img src="${imgSrc}" style="width:90px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #ddd;" />`
        : `<div style="width:90px;height:90px;border-radius:6px;background:#f3f4f6;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:11px;color:#9ca3af;">No image</div>`;

      const fields = [
        item.maker ? `<div style="margin-top:3px;font-size:11px;"><b>Maker:</b> ${escHtml(item.maker)}</div>` : "",
        item.makerInfo ? `<div style="margin-top:2px;font-size:10px;color:#555;">${escHtml(item.makerInfo)}</div>` : "",
        item.shape ? `<div style="margin-top:3px;font-size:11px;"><b>Shape:</b> ${escHtml(item.shape)}</div>` : "",
        item.style ? `<div style="margin-top:2px;font-size:11px;"><b>Style:</b> ${escHtml(item.style)}</div>` : "",
        item.dimensions ? `<div style="margin-top:2px;font-size:11px;"><b>Dimensions:</b> ${escHtml(item.dimensions)}</div>` : "",
        item.acquiredAt ? `<div style="margin-top:2px;font-size:11px;"><b>Acquired:</b> ${formatDate(item.acquiredAt)}</div>` : "",
        item.quantity && item.quantity > 1 ? `<div style="margin-top:2px;font-size:11px;"><b>Qty:</b> ${item.quantity}</div>` : "",
        item.categories && item.categories.length > 0
          ? `<div style="margin-top:2px;font-size:11px;"><b>Categories:</b> ${item.categories.map((c) => escHtml(c.name)).join(", ")}</div>`
          : "",
        item.notes ? `<div style="margin-top:4px;font-size:10px;color:#666;font-style:italic;">${escHtml(item.notes)}</div>` : "",
      ].join("");

      return `
        <tr>
          <td style="padding:10px 8px;vertical-align:top;border-bottom:1px solid #e5e7eb;">${imgTag}</td>
          <td style="padding:10px 10px;vertical-align:top;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:13px;font-weight:bold;margin-bottom:2px;">${escHtml(item.name)}</div>
            ${fields}
          </td>
        </tr>`;
    })
    .join("\n");

  container.innerHTML = `
    <div style="margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #1f2937;">
      <div style="font-size:26px;font-weight:bold;margin-bottom:6px;">Pottery Collection</div>
      <div style="font-size:13px;color:#555;margin-bottom:4px;">Insurance &amp; Provenance Record</div>
      <div style="font-size:12px;color:#444;">${items.length} piece${items.length !== 1 ? "s" : ""} — exported ${escHtml(coverDate)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tbody>${rows}</tbody>
    </table>`;

  return container;
}

// ── PDF export ─────────────────────────────────────────────────────────────────

async function generateInsurancePdf(
  items: PotteryItem[],
  onProgress: (msg: string) => void,
): Promise<void> {
  onProgress(`Loading images…  0 / ${items.length}`);

  const imageDataUrls = await prefetchImages(items, (loaded, total) => {
    onProgress(`Loading images… ${loaded} / ${total}`);
  });

  onProgress("Rendering layout…");

  const container = buildPrintContainer(items, imageDataUrls);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: false,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
    });

    onProgress("Building PDF…");

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();

    const imgData = canvas.toDataURL("image/jpeg", 0.88);
    const imgRatio = canvas.width / canvas.height;
    const imgW = pdfW;
    const imgH = imgW / imgRatio;

    let yOffset = 0;
    let pageNum = 0;

    while (yOffset < imgH) {
      if (pageNum > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, -yOffset, imgW, imgH);
      yOffset += pdfH;
      pageNum++;
    }

    // Page numbers
    for (let p = 1; p <= pageNum; p++) {
      pdf.setPage(p);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(160, 160, 160);
      pdf.text(`Page ${p} of ${pageNum}`, pdfW - 12, pdfH - 8, { align: "right" });
    }

    pdf.save("pottery-collection-insurance.pdf");
  } finally {
    document.body.removeChild(container);
  }
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
