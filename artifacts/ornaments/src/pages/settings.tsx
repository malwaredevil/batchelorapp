import { useState } from "react";
import { Link } from "wouter";
import {
  Tag,
  Wrench,
  KeyRound,
  ChevronRight,
  FileDown,
  Loader2,
  BarChart3,
  CalendarHeart,
} from "lucide-react";
import { useListOrnaments } from "@workspace/api-client-react";
import type { OrnamentsOrnamentItem as OrnamentItem } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePageAssistantContext } from "@/lib/assistant-context";
import { generateInsurancePdf } from "@/lib/pdf-export";

const SETTINGS_ITEMS = [
  {
    href: "/categories",
    label: "Categories",
    description: "Manage collection categories and colors",
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
    description: "Bulk re-analyze ornaments in the collection",
    icon: Wrench,
  },
  {
    href: "/hallmark-events",
    label: "Hallmark Events",
    description: "Manage Open House and other Hallmark Keepsake dates",
    icon: CalendarHeart,
  },
  {
    href: "/account",
    label: "Account",
    description: "Change your sign-in password",
    icon: KeyRound,
  },
];

export function InsuranceExportButton({
  items,
}: {
  items: OrnamentItem[] | undefined;
}) {
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
      toast.success(`PDF downloaded — ${items.length} ornaments`);
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
      className="w-full justify-start gap-3 h-auto px-5 py-4 rounded-none border-x-0 border-b-0 hover:bg-muted/40 transition-colors"
    >
      {generating ? (
        <Loader2 className="h-5 w-5 shrink-0 text-muted-foreground animate-spin" />
      ) : (
        <FileDown className="h-5 w-5 shrink-0 text-muted-foreground" />
      )}
      <div className="flex-1 text-left">
        <p className="font-medium font-serif tracking-wide">
          Export for insurance
        </p>
        <p className="text-sm text-muted-foreground">
          {generating
            ? progress
            : "Download a PDF with photos of every ornament"}
        </p>
      </div>
    </Button>
  );
}

export default function Settings() {
  const { data: listData } = useListOrnaments({ pageSize: 1000 });
  const items = listData?.items;

  usePageAssistantContext(
    "ornaments-settings",
    `Settings page: links to Categories, Collection Stats, Maintenance, and Account. Also offers an "Export for insurance" action that downloads a PDF with photos and details of every ornament (${items?.length ?? 0} piece(s) currently in the collection).`,
  );

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground">
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your collection preferences
        </p>
      </div>

      <ul className="mt-6 divide-y divide-card-border rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
        {SETTINGS_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40 group"
            >
              <item.icon className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
              <div className="flex-1">
                <p className="font-medium font-serif tracking-wide">
                  {item.label}
                </p>
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
