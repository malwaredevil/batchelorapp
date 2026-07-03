import { useState, useCallback } from "react";
import { Upload, FileSpreadsheet, Check, AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { toast } from "sonner";
import * as XLSX from "@e965/xlsx";
import { useQueryClient } from "@tanstack/react-query";
import { getListTripsQueryKey, getGetTravelsStatsQueryKey, getListWishlistQueryKey } from "@workspace/api-client-react";

interface ParsedTrip {
  title: string;
  destination: string;
  status: "completed" | "booked" | "planning";
  startDate?: string;
  endDate?: string;
  travelers: string[];
  theOneThing: string[];
  notes?: string;
  travellerCount: number;
  transportTo?: "drove" | "flew" | "train";
  accommodationName?: string;
}

interface ParsedWishlistItem {
  destination: string;
  done: boolean;
  targetDate?: string;
}

interface ParsedData {
  trips: ParsedTrip[];
  wishlistItems: ParsedWishlistItem[];
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/(?:^|\s)\S/g, (c) => c.toUpperCase()).trim();
}

function parseTravelers(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .replace(/ and /gi, ", ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(toTitleCase);
}

function parseOneThings(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(toTitleCase);
}

function excelDateToString(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return undefined;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (typeof v === "string") {
    const m = v.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2}\/\d{4})/);
    return m ? m[0] : undefined;
  }
  return undefined;
}

function inferStatus(startDate?: string, endDate?: string): "completed" | "booked" | "planning" {
  const today = new Date().toISOString().slice(0, 10);
  if (!startDate) return "planning";
  if (startDate > today) return "booked";
  return "completed";
}

function parseWorkbook(wb: XLSX.WorkBook): ParsedData {
  const trips: ParsedTrip[] = [];
  const wishlistItems: ParsedWishlistItem[] = [];

  const yearSheets = wb.SheetNames.filter((n) => /^20\d\d$/.test(n.trim()));

  for (const sheetName of yearSheets) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

    for (const row of rows) {
      const dest =
        String(row["Destination"] ?? row["destination"] ?? row["DESTINATION"] ?? "").trim();
      if (!dest || dest.toLowerCase() === "destination") continue;

      const startDate = excelDateToString(
        row["Start Date"] ?? row["start date"] ?? row["Start"] ?? row["start"],
      );
      const endDate = excelDateToString(
        row["End Date"] ?? row["end date"] ?? row["End"] ?? row["end"],
      );

      const travelersRaw = String(
        row["Travelers"] ?? row["travelers"] ?? row["Who"] ?? row["who"] ?? "",
      ).trim();
      const oneThingRaw = String(
        row["The One Thing"] ?? row["One Thing"] ?? row["one thing"] ?? row["Highlight"] ?? "",
      ).trim();
      const notesRaw = String(row["Notes"] ?? row["notes"] ?? "").trim();
      const accomRaw = String(
        row["Hotel"] ?? row["hotel"] ?? row["Accommodation"] ?? row["accommodation"] ?? "",
      ).trim();
      const transportRaw = String(row["Transport"] ?? row["transport"] ?? "").trim().toLowerCase();

      const travelers = parseTravelers(travelersRaw);
      const theOneThing = parseOneThings(oneThingRaw);
      const status = inferStatus(startDate, endDate);

      let transportTo: "drove" | "flew" | "train" | undefined;
      if (transportRaw.includes("fly") || transportRaw.includes("flight") || transportRaw.includes("flew"))
        transportTo = "flew";
      else if (transportRaw.includes("train")) transportTo = "train";
      else if (transportRaw.includes("driv") || transportRaw.includes("drove") || transportRaw.includes("car"))
        transportTo = "drove";

      trips.push({
        title: dest,
        destination: dest,
        status,
        startDate,
        endDate,
        travelers,
        theOneThing,
        notes: notesRaw || undefined,
        travellerCount: travelers.length || 2,
        transportTo,
        accommodationName: accomRaw || undefined,
      });
    }
  }

  const wishlistSheet =
    wb.Sheets["Wishlist"] ?? wb.Sheets["wishlist"] ?? wb.Sheets["WISHLIST"] ?? wb.Sheets["Countries"];
  if (wishlistSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wishlistSheet, { defval: "" });
    for (const row of rows) {
      const dest = String(
        row["Destination"] ?? row["destination"] ?? row["Country"] ?? row["country"] ?? "",
      ).trim();
      if (!dest || dest.toLowerCase() === "destination" || dest.toLowerCase() === "country") continue;
      const doneRaw = row["Done"] ?? row["done"] ?? row["Visited"] ?? row["visited"] ?? "";
      const done =
        typeof doneRaw === "boolean"
          ? doneRaw
          : String(doneRaw).toLowerCase() === "true" ||
            String(doneRaw) === "1" ||
            String(doneRaw).toLowerCase() === "yes" ||
            String(doneRaw) === "✓";
      const targetDate = excelDateToString(row["Target Date"] ?? row["target date"] ?? row["Date"]);
      wishlistItems.push({ destination: dest, done, targetDate });
    }
  }

  return { trips, wishlistItems };
}

type Step = "upload" | "preview" | "done";

export default function Import() {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    tripsCreated: number;
    tripsSkipped: number;
    wishlistCreated: number;
    wishlistSkipped: number;
  } | null>(null);

  const handleFile = useCallback((file: File) => {
    if (!file.name.match(/\.(xlsx|xls|ods|csv)$/i)) {
      toast.error("Please upload a spreadsheet file (.xlsx, .xls, .ods, .csv)");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: "array", cellDates: false });
        const result = parseWorkbook(wb);
        if (result.trips.length === 0 && result.wishlistItems.length === 0) {
          toast.error("No trips or wishlist items found. Check the spreadsheet format.");
          return;
        }
        setParsed(result);
        setStep("preview");
      } catch (err) {
        console.error(err);
        toast.error("Failed to parse spreadsheet. Check the file format.");
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    try {
      const res = await fetch("/api/travels/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      setImportResult(result);
      setStep("done");
      qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetTravelsStatsQueryKey() });
      qc.invalidateQueries({ queryKey: getListWishlistQueryKey() });
      toast.success("Import complete!");
    } catch (err) {
      console.error(err);
      toast.error("Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl text-foreground flex items-center gap-2">
          <Upload className="w-6 h-6" />
          Import from Spreadsheet
        </h1>
        <p className="text-muted-foreground mt-1">
          Upload your Excel travel log to import past trips and wishlist destinations.
        </p>
      </div>

      {step === "upload" && (
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <label
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-border/60 rounded-xl cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
            >
              <FileSpreadsheet className="w-10 h-10 text-muted-foreground mb-3 opacity-60" />
              <p className="text-sm font-medium text-foreground">
                Drop your spreadsheet here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Supports .xlsx, .xls, .ods, .csv
              </p>
              <input
                type="file"
                accept=".xlsx,.xls,.ods,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </label>

            <div className="mt-4 p-4 bg-muted/40 rounded-lg text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Expected format:</p>
              <p>• One sheet per year (e.g. "2024", "2025") with columns: Destination, Start Date, End Date, Travelers, The One Thing</p>
              <p>• A "Wishlist" or "Countries" sheet with: Destination, Done (optional), Target Date (optional)</p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "preview" && parsed && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Found <strong className="text-foreground">{parsed.trips.length} trips</strong> and{" "}
              <strong className="text-foreground">{parsed.wishlistItems.length} wishlist items</strong> in{" "}
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{fileName}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Change file
              </Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...</>
                ) : (
                  <><ArrowRight className="w-4 h-4 mr-2" /> Import all</>
                )}
              </Button>
            </div>
          </div>

          {parsed.trips.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Trips ({parsed.trips.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/30">
                        <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">Destination</th>
                        <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">Dates</th>
                        <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">Who</th>
                        <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">The One Thing</th>
                        <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.trips.map((t, i) => (
                        <tr key={i} className="border-b border-border/30 hover:bg-muted/20">
                          <td className="px-4 py-2 font-medium">{t.destination}</td>
                          <td className="px-4 py-2 text-muted-foreground text-xs">
                            {t.startDate ? `${t.startDate}${t.endDate ? ` → ${t.endDate}` : ""}` : "—"}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground text-xs">
                            {t.travelers.join(", ") || "—"}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground text-xs max-w-[200px] truncate">
                            {t.theOneThing.join(", ") || "—"}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full border ${
                              t.status === "completed" ? "border-red-200 text-red-700 bg-red-50 dark:border-red-900 dark:text-red-400 dark:bg-red-950" :
                              t.status === "booked" ? "border-green-200 text-green-700 bg-green-50 dark:border-green-900 dark:text-green-400 dark:bg-green-950" :
                              t.status === "planning" ? "border-orange-200 text-orange-700 bg-orange-50 dark:border-orange-900 dark:text-orange-400 dark:bg-orange-950" :
                              "border-border text-muted-foreground"
                            }`}>
                              {t.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {parsed.wishlistItems.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Wishlist ({parsed.wishlistItems.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {parsed.wishlistItems.map((w, i) => (
                    <span
                      key={i}
                      className={`text-xs px-2 py-1 rounded-full border ${
                        w.done
                          ? "border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-900 dark:text-emerald-400 dark:bg-emerald-950 line-through opacity-70"
                          : "border-border text-foreground"
                      }`}
                    >
                      {w.destination}
                      {w.done && " ✓"}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {step === "done" && importResult && (
        <Card className="border-emerald-200 dark:border-emerald-900">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-lg">Import complete!</p>
              <p className="text-muted-foreground text-sm mt-1">
                {importResult.tripsCreated} trips imported
                {importResult.tripsSkipped > 0 && `, ${importResult.tripsSkipped} already existed`}
                {" · "}
                {importResult.wishlistCreated} wishlist items imported
                {importResult.wishlistSkipped > 0 && `, ${importResult.wishlistSkipped} already existed`}
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => { setParsed(null); setStep("upload"); }}>
                Import more
              </Button>
              <Button onClick={() => window.location.href = "/trips"}>
                View trips
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
