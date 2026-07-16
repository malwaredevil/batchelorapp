/**
 * Generic PDF export engine for household collection apps.
 *
 * Pottery and Ornaments both generate A4 insurance-record PDFs with the same
 * orchestration: batch-fetch images → paginate → rasterize each page via
 * html2canvas → stitch pages in jsPDF. This file contains all the shared
 * infrastructure; domain-specific page layout lives in each app's
 * `buildPageContainer` callback.
 */
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

// ── Shared helpers ──────────────────────────────────────────────────────────

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return isNaN(dt.getTime())
    ? "—"
    : dt.toLocaleDateString("en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

export function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Fetch one image as a data URL (uses session credentials). */
export async function fetchAsDataUrl(url: string): Promise<string | null> {
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

/** Pre-fetch all item images in parallel batches of 8. */
export async function prefetchImages<T extends { imageUrl: string }>(
  items: T[],
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

/** Render a DOM element off-screen to a JPEG data URL via html2canvas. */
export async function containerToJpeg(el: HTMLElement): Promise<string> {
  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: false,
    allowTaint: false,
    backgroundColor: "#ffffff",
    logging: false,
  });
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** Standard A4-equivalent page width at 96dpi. */
export const PAGE_WIDTH_PX = 794;

// ── Generic orchestration ───────────────────────────────────────────────────

export interface CollectionPdfOptions<T> {
  /** Number of items laid out on each PDF page. */
  itemsPerPage: number;
  /**
   * Domain-specific page builder. Receives the subset of items + pre-fetched
   * images for one page and returns an off-screen HTMLDivElement ready for
   * html2canvas rasterization.
   */
  buildPageContainer: (
    items: T[],
    imageDataUrls: (string | null)[],
    pageNum: number,
    totalPages: number,
    exportDate: string,
    totalItems: number,
  ) => HTMLDivElement;
  /** Output filename, or a function that derives it from the full item list. */
  filename: string | ((items: T[]) => string);
  onProgress: (msg: string) => void;
}

/**
 * Orchestrates a multi-page A4 PDF export for any collection domain.
 *
 * Phase 1 — parallel-batch image fetch.
 * Phase 2 — paginate, rasterize off-screen DOM containers, stitch into jsPDF.
 */
export async function generateCollectionPdf<T extends { imageUrl: string }>(
  items: T[],
  options: CollectionPdfOptions<T>,
): Promise<void> {
  const { itemsPerPage, buildPageContainer, filename, onProgress } = options;
  const exportDate = formatDate(new Date().toISOString());

  // Phase 1: fetch images
  onProgress(`Loading images… 0 / ${items.length}`);
  const imageDataUrls = await prefetchImages(items, (loaded, total) => {
    onProgress(`Loading images… ${loaded} / ${total}`);
  });

  // Phase 2: paginate + rasterize
  const totalPages = Math.ceil(items.length / itemsPerPage);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pageNum = pageIdx + 1;
    onProgress(`Rendering page ${pageNum} of ${totalPages}…`);

    const start = pageIdx * itemsPerPage;
    const end = Math.min(start + itemsPerPage, items.length);
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

      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.src = jpeg;
      });

      const aspectRatio = img.naturalWidth / img.naturalHeight;
      const imgWmm = pdfW;
      const imgHmm = imgWmm / aspectRatio;
      const finalH = Math.min(imgHmm, pdfH);
      const finalW = finalH * aspectRatio;
      const xOffset = (pdfW - finalW) / 2;

      pdf.addImage(jpeg, "JPEG", xOffset, 0, finalW, finalH);
    } finally {
      document.body.removeChild(container);
    }
  }

  onProgress("Saving PDF…");
  const resolvedFilename =
    typeof filename === "function" ? filename(items) : filename;
  pdf.save(resolvedFilename);
}
