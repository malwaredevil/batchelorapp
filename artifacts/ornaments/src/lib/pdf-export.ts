import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import type { OrnamentsOrnamentItem as OrnamentItem } from "@workspace/api-client-react";

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

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
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
  items: OrnamentItem[],
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
const ITEMS_PER_PAGE = 5; // safe chunk: 5 items × ~120px row ≈ 900px canvas height

/** Build a single-page DOM container for a chunk of items. */
function buildPageContainer(
  items: OrnamentItem[],
  imageDataUrls: (string | null)[],
  pageNum: number,
  totalPages: number,
  exportDate: string,
  totalItems: number,
  totalEstimate: number
): HTMLDivElement {
  const container = document.createElement("div");
  container.style.cssText = [
    "position: absolute",
    "left: -9999px",
    "top: 0",
    `width: ${PAGE_WIDTH_PX}px`,
    "font-family: 'Times New Roman', Times, serif",
    "background: #fff",
    "color: #111",
    "padding: 32px 36px 24px",
    "box-sizing: border-box",
  ].join("; ");

  const header =
    pageNum === 1
      ? `<div style="margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #332211;">
           <div style="font-size:24px;font-weight:bold;margin-bottom:4px;color:#332211;">Hallmark Keepsake Collection</div>
           <div style="font-size:12px;color:#555;">Insurance Record — ${escHtml(exportDate)} — ${totalItems} ornament${totalItems !== 1 ? "s" : ""}</div>
           ${totalEstimate > 0 ? `<div style="font-size:12px;color:#555;margin-top:2px;">Total Estimated Value: <b>${formatCurrency(totalEstimate)}</b></div>` : ""}
         </div>`
      : `<div style="margin-bottom:12px;font-size:10px;color:#aaa;">Hallmark Keepsake Collection — Insurance Record (continued)</div>`;

  const rows = items
    .map((item, i) => {
      const imgSrc = imageDataUrls[i];
      const imgTag = imgSrc
        ? `<img src="${escHtml(imgSrc)}" style="width:100px;height:100px;object-fit:cover;border-radius:6px;border:1px solid #ddd;display:block;" />`
        : `<div style="width:100px;height:100px;border-radius:6px;background:#f8f5f2;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:10px;color:#9ca3af;text-align:center;">No image</div>`;

      const fields = [
        item.brand
          ? `<span style="font-size:11px;"><b>Brand:</b> ${escHtml(item.brand)}</span>`
          : "",
        item.seriesOrCollection
          ? `<span style="font-size:11px;"><b>Series/Collection:</b> ${escHtml(item.seriesOrCollection)}</span>`
          : "",
        item.year
          ? `<span style="font-size:11px;"><b>Year:</b> ${item.year}</span>`
          : "",
        item.dimensions
          ? `<span style="font-size:11px;"><b>Dimensions:</b> ${escHtml(item.dimensions)}</span>`
          : "",
        item.condition
          ? `<span style="font-size:11px;"><b>Condition:</b> ${escHtml(item.condition)}</span>`
          : "",
        item.quantity && item.quantity > 1
          ? `<span style="font-size:11px;"><b>Qty:</b> ${item.quantity}</span>`
          : "",
        item.categories && item.categories.length > 0
          ? `<span style="font-size:11px;"><b>Categories:</b> ${item.categories.map((c) => escHtml(c.name)).join(", ")}</span>`
          : "",
        item.bookValue != null
          ? `<span style="font-size:11px;color:#854d0e;"><b>Est. Value:</b> ${formatCurrency(item.bookValue)}</span>`
          : "",
        item.notes
          ? `<br/><span style="font-size:10px;color:#666;font-style:italic;">${escHtml(item.notes)}</span>`
          : "",
      ]
        .filter(Boolean)
        .join(`<span style="color:#ddd;margin:0 5px;">·</span>`);

      // Clean up the break hack above so it looks nice
      const cleanFields = fields.replace(/<span style="color:#ddd;margin:0 5px;">·<\/span><br\/>/g, "<br/>");

      return `
        <tr>
          <td style="padding:12px 8px;vertical-align:top;border-bottom:1px solid #f0ece6;width:116px;">${imgTag}</td>
          <td style="padding:12px 10px;vertical-align:top;border-bottom:1px solid #f0ece6;">
            <div style="font-size:14px;font-weight:bold;margin-bottom:6px;color:#332211;">${escHtml(item.name)}</div>
            <div style="line-height:1.8;">${cleanFields}</div>
          </td>
        </tr>`;
    })
    .join("\n");

  const footer = `
    <div style="margin-top:14px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:9px;color:#aaa;display:flex;justify-content:space-between;">
      <span>Batchelor Household — Ornaments Collection</span>
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
  return canvas.toDataURL("image/jpeg", 0.9);
}

// ── Main PDF generator ────────────────────────────────────────────────────────

export async function generateInsurancePdf(
  items: OrnamentItem[],
  onProgress: (msg: string) => void,
): Promise<void> {
  const exportDate = formatDate(new Date().toISOString());

  // Calculate totals
  const totalEstimate = items.reduce((sum, item) => sum + (item.bookValue || 0), 0);

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
      totalEstimate
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
  
  if (items.length === 1) {
    pdf.save(`ornament-${items[0].id}-insurance.pdf`);
  } else {
    pdf.save("ornaments-collection-insurance.pdf");
  }
}
