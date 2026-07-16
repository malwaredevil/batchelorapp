import type { OrnamentsOrnamentItem as OrnamentItem } from "@workspace/api-client-react";
import {
  generateCollectionPdf,
  formatDate,
  escHtml,
  PAGE_WIDTH_PX,
} from "../../lib/pdf-export";

const ITEMS_PER_PAGE = 5;

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function buildPageContainer(
  items: OrnamentItem[],
  imageDataUrls: (string | null)[],
  pageNum: number,
  totalPages: number,
  exportDate: string,
  totalItems: number,
  totalEstimate: number,
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

      const cleanFields = fields.replace(
        /<span style="color:#ddd;margin:0 5px;">·<\/span><br\/>/g,
        "<br/>",
      );

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

export async function generateInsurancePdf(
  items: OrnamentItem[],
  onProgress: (msg: string) => void,
): Promise<void> {
  const totalEstimate = items.reduce(
    (sum, item) => sum + (item.bookValue || 0),
    0,
  );
  const filename =
    items.length === 1
      ? `ornament-${items[0].id}-insurance.pdf`
      : "ornaments-collection-insurance.pdf";

  await generateCollectionPdf(items, {
    itemsPerPage: ITEMS_PER_PAGE,
    buildPageContainer: (
      pageItems,
      pageImages,
      pageNum,
      totalPages,
      exportDate,
      totalItems,
    ) =>
      buildPageContainer(
        pageItems,
        pageImages,
        pageNum,
        totalPages,
        exportDate,
        totalItems,
        totalEstimate,
      ),
    filename,
    onProgress,
  });
}
