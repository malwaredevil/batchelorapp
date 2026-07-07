import { useState } from "react";
import { Link } from "wouter";
import { Tag, Wrench, KeyRound, ChevronRight, FileDown, Loader2, BarChart3 } from "lucide-react";
import { useListPottery } from "@workspace/api-client-react";
import type { PotteryPotteryItem as PotteryItem } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import jsPDF from "jspdf";

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
  return isNaN(dt.getTime())
    ? "—"
    : dt.toLocaleDateString("en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

async function generateInsurancePdf(items: PotteryItem[]): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;

  // ── Cover page ─────────────────────────────────────────────────────────────
  doc.setFillColor(245, 245, 240);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(17, 17, 17);
  doc.text("Pottery Collection", margin, 44);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(80, 80, 80);
  doc.text("Insurance & Provenance Record", margin, 54);

  doc.setLineWidth(0.5);
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, 60, pageWidth - margin, 60);

  doc.setFontSize(11);
  doc.setTextColor(50, 50, 50);
  doc.text(
    `${items.length} piece${items.length !== 1 ? "s" : ""} — exported ${formatDate(new Date().toISOString())}`,
    margin,
    68,
  );

  // ── Item pages ─────────────────────────────────────────────────────────────
  let y = 90;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (y > pageHeight - 40) {
      doc.addPage();
      y = margin;
    }

    // Item name
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(17, 17, 17);
    const nameLines = doc.splitTextToSize(item.name, contentWidth);
    doc.text(nameLines, margin, y);
    y += nameLines.length * 6 + 1;

    // Fields
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(60, 60, 60);

    const fields: [string, string | undefined | null][] = [
      ["Maker", item.maker],
      ["Shape", item.shape],
      ["Style", item.style],
      ["Dimensions", item.dimensions],
      ["Acquired", item.acquiredAt ? formatDate(item.acquiredAt) : null],
      ["Quantity", item.quantity && item.quantity > 1 ? String(item.quantity) : null],
      ["Categories", item.categories?.map((c) => c.name).join(", ") || null],
    ];

    for (const [label, value] of fields) {
      if (!value) continue;
      if (y > pageHeight - 20) {
        doc.addPage();
        y = margin;
      }
      doc.setFont("helvetica", "bold");
      doc.setTextColor(80, 80, 80);
      doc.text(`${label}:`, margin + 3, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
      const valueLines = doc.splitTextToSize(value, contentWidth - 30);
      doc.text(valueLines, margin + 28, y);
      y += Math.max(valueLines.length, 1) * 5 + 1;
    }

    if (item.notes) {
      if (y > pageHeight - 20) {
        doc.addPage();
        y = margin;
      }
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      const noteLines = doc.splitTextToSize(`Notes: ${item.notes}`, contentWidth - 6);
      doc.text(noteLines, margin + 3, y);
      y += noteLines.length * 4.5 + 1;
    }

    // Divider
    doc.setLineWidth(0.2);
    doc.setDrawColor(210, 210, 210);
    doc.line(margin, y + 3, pageWidth - margin, y + 3);
    y += 10;
  }

  // ── Footer on every page ───────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.text(
      `Page ${p} of ${totalPages}`,
      pageWidth - margin,
      pageHeight - 8,
      { align: "right" },
    );
    doc.text("Batchelor Pottery Collection", margin, pageHeight - 8);
  }

  doc.save("pottery-collection-insurance.pdf");
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
      await generateInsurancePdf(items);
      toast.success(`PDF downloaded — ${items.length} pieces`);
    } catch {
      toast.error("PDF generation failed. Try again.");
    } finally {
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
          Download a PDF record of every piece
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
