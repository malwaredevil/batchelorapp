import type { PotteryPotteryItem as PotteryItem } from "@workspace/api-client-react";
import {
  generateCollectionPdf,
  formatDate,
  escHtml,
  PAGE_WIDTH_PX,
} from "../../lib/pdf-export";

const ITEMS_PER_PAGE = 6;

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
        ? `<img src="${escHtml(imgSrc)}" style="width:80px;height:80px;object-fit:cover;border-radius:5px;border:1px solid #ddd;display:block;" />`
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

export async function generateInsurancePdf(
  items: PotteryItem[],
  onProgress: (msg: string) => void,
): Promise<void> {
  await generateCollectionPdf(items, {
    itemsPerPage: ITEMS_PER_PAGE,
    buildPageContainer,
    filename: "pottery-collection-insurance.pdf",
    onProgress,
  });
}
