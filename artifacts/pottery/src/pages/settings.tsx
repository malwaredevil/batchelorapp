import { useState } from "react";
import { Link } from "wouter";
import { Tag, Wrench, KeyRound, ChevronRight, FileDown, Loader2, BarChart3 } from "lucide-react";
import { useListPottery } from "@workspace/api-client-react";
import type { PotteryPotteryItem as PotteryItem } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

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

// ── Insurance PDF export ──────────────────────────────────────────────────────

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
}

function buildPrintHtml(items: PotteryItem[]): string {
  const rows = items
    .map(
      (item) => `
    <tr class="item-row">
      <td class="img-cell">
        <img src="${item.imageUrl}" alt="${escHtml(item.name)}" />
      </td>
      <td class="details-cell">
        <div class="item-name">${escHtml(item.name)}</div>
        ${item.maker ? `<div class="field"><span class="label">Maker:</span> ${escHtml(item.maker)}</div>` : ""}
        ${item.makerInfo ? `<div class="field"><span class="label">Maker info:</span> ${escHtml(item.makerInfo)}</div>` : ""}
        ${item.shape ? `<div class="field"><span class="label">Shape:</span> ${escHtml(item.shape)}</div>` : ""}
        ${item.style ? `<div class="field"><span class="label">Style:</span> ${escHtml(item.style)}</div>` : ""}
        ${item.dimensions ? `<div class="field"><span class="label">Dimensions:</span> ${escHtml(item.dimensions)}</div>` : ""}
        <div class="field"><span class="label">Acquired:</span> ${formatDate(item.acquiredAt)}</div>
        ${item.quantity && item.quantity > 1 ? `<div class="field"><span class="label">Quantity:</span> ${item.quantity}</div>` : ""}
        ${item.categories && item.categories.length > 0 ? `<div class="field"><span class="label">Categories:</span> ${item.categories.map((c) => escHtml(c.name)).join(", ")}</div>` : ""}
        ${item.notes ? `<div class="field notes"><span class="label">Notes:</span> ${escHtml(item.notes)}</div>` : ""}
      </td>
    </tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Pottery Collection — Insurance Export</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; background: #fff; font-size: 12px; }
    .cover { page-break-after: always; padding: 60px 40px; border-bottom: 2px solid #111; }
    .cover h1 { font-size: 28px; margin-bottom: 8px; }
    .cover p { color: #555; font-size: 14px; }
    .cover .count { margin-top: 16px; font-size: 16px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; }
    .item-row { border-bottom: 1px solid #ddd; page-break-inside: avoid; }
    .img-cell { width: 120px; padding: 12px; vertical-align: top; }
    .img-cell img { width: 100px; height: 100px; object-fit: cover; border-radius: 6px; border: 1px solid #ddd; }
    .details-cell { padding: 12px 12px 12px 4px; vertical-align: top; }
    .item-name { font-size: 14px; font-weight: bold; margin-bottom: 4px; }
    .field { margin-top: 3px; line-height: 1.4; }
    .label { font-weight: bold; color: #444; }
    .notes { color: #555; font-style: italic; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="cover">
    <h1>Pottery Collection</h1>
    <p>Insurance &amp; Provenance Record</p>
    <p class="count">${items.length} piece${items.length !== 1 ? "s" : ""} — exported ${new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}</p>
  </div>
  <table>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function InsuranceExportButton({ items }: { items: PotteryItem[] | undefined }) {
  const [generating, setGenerating] = useState(false);

  const handleExport = async () => {
    if (!items || items.length === 0) {
      toast.error("No items to export");
      return;
    }
    setGenerating(true);

    try {
      const html = buildPrintHtml(items);
      const win = window.open("", "_blank");
      if (!win) {
        toast.error("Pop-up blocked — allow pop-ups and try again");
        return;
      }
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => {
        win.print();
        setGenerating(false);
      }, 600);
    } catch {
      toast.error("Export failed. Try again.");
      setGenerating(false);
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
          Generate a printable PDF record of every piece
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
