import React from "react";
import "./_group.css";
import {
  RefreshCw,
  Download,
  Edit3,
  Trash2,
  Lock,
  Sparkles,
  BookOpen,
  Plus,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export function WideCanvas() {
  return (
    <div className="wide-canvas-container pt-12 pb-24 px-12">
      <div className="max-w-[1340px] mx-auto flex gap-8 items-start">
        {/* Left Column (38%) */}
        <div className="w-[38%] flex flex-col gap-4">
          <div className="w-full aspect-[4/5] rounded-xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.08)] bg-gradient-to-br from-red-100 to-amber-100 flex items-center justify-center">
            {/* Placeholder for primary image */}
            <div className="text-amber-700/40 font-medium text-lg tracking-widest uppercase">
              Primary Photo
            </div>
          </div>

          <div className="flex gap-4">
            <div className="w-20 h-20 rounded-md bg-gradient-to-br from-green-100 to-emerald-100 shadow-sm border border-black/5" />
            <div className="w-20 h-20 rounded-md bg-gradient-to-br from-purple-100 to-fuchsia-100 shadow-sm border border-black/5" />
            <button className="w-20 h-20 rounded-md border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors">
              <Plus className="w-6 h-6 mb-1" />
            </button>
          </div>

          <div className="mt-2 text-sm text-[var(--ornament-muted)] hover:text-red-600 cursor-pointer transition-colors w-fit">
            Delete current photo
          </div>
        </div>

        {/* Center Column (34%) */}
        <div className="w-[34%] flex flex-col pt-2 pb-6 px-6 bg-white/40 rounded-xl border border-[var(--ornament-card-border)] shadow-sm">
          <div className="mb-8">
            <h1 className="font-serif-orn text-4xl font-semibold leading-tight text-[var(--ornament-text)] mb-2">
              2016 Sweet Decade Snowman
            </h1>
            <div className="text-sm font-medium tracking-widest text-[var(--ornament-muted)] uppercase">
              HALLMARK · 2016
            </div>
          </div>

          <div className="flex flex-col mb-8 bg-white rounded-lg border border-[var(--ornament-card-border)] overflow-hidden shadow-sm">
            {[
              { label: "Brand", value: "Hallmark" },
              { label: "Year", value: "2016" },
              { label: "Series / Collection", value: "Sweet Decade" },
              { label: "Dimensions", value: "3.5 in" },
              { label: "Barcode / UPC", value: "661127022308", mono: true },
            ].map((field, i) => (
              <div
                key={i}
                className="label-field flex justify-between items-center px-4 py-3"
              >
                <span className="text-sm text-[var(--ornament-muted)] flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 opacity-50" />
                  {field.label}
                </span>
                <span
                  className={`text-sm font-medium text-[var(--ornament-text)] ${field.mono ? "font-mono" : ""}`}
                >
                  {field.value}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mb-8">
            <Badge
              variant="secondary"
              className="bg-white hover:bg-gray-50 border border-[var(--ornament-card-border)] text-gray-600"
            >
              Snowman
            </Badge>
            <Badge
              variant="secondary"
              className="bg-white hover:bg-gray-50 border border-[var(--ornament-card-border)] text-gray-600"
            >
              Christmas
            </Badge>
            <Badge
              variant="secondary"
              className="bg-white hover:bg-gray-50 border border-[var(--ornament-card-border)] text-gray-600"
            >
              Hallmark Keepsake
            </Badge>
          </div>

          <Card className="mb-8 bg-amber-50/50 border-amber-200/50 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-[var(--ai-amber)]" />
                <span className="text-sm font-semibold text-[var(--ornament-text)]">
                  AI Description
                </span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">
                "This whimsical ornament features a festive snowman surrounded
                by sparkling, candy-like numbers forming '2016'. The snowman
                sports a red hat and a colorful striped scarf. Part of the Sweet
                Decade series."
              </p>
            </CardContent>
          </Card>

          <div>
            <div className="text-sm font-medium text-[var(--ornament-muted)] mb-3 uppercase tracking-wider">
              Colors & Motifs
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1.5 mr-2">
                {["#ffffff", "#ef4444", "#22c55e", "#eab308", "#a855f7"].map(
                  (color, i) => (
                    <div
                      key={i}
                      className="w-4 h-4 rounded-full border border-gray-200 shadow-inner"
                      style={{ backgroundColor: color }}
                    />
                  ),
                )}
              </div>
              <div className="h-4 w-px bg-[var(--ornament-card-border)] mx-1" />
              {["snowman", "numbers", "candy", "hat", "scarf"].map((tag) => (
                <span
                  key={tag}
                  className="text-xs text-gray-500 bg-gray-100/80 px-2 py-1 rounded-md flex items-center gap-1"
                >
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column (28%) */}
        <div className="w-[28%] flex flex-col gap-6 sticky top-12">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="bg-white border-[var(--ornament-card-border)] text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-white border-[var(--ornament-card-border)] text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              >
                <Download className="w-4 h-4 mr-2" />
                PDF
              </Button>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-400 hover:text-gray-600 h-9 w-9"
              >
                <Edit3 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-400 hover:text-red-600 h-9 w-9"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <Card className="bg-white border-[var(--ebay-gold)] shadow-sm overflow-hidden">
            <div className="h-1 bg-[var(--ebay-gold)]" />
            <CardContent className="p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--ornament-text)] flex items-center gap-1.5">
                    eBay Market Data
                  </h3>
                  <p className="text-xs text-[var(--ornament-muted)] mt-1">
                    For Sale Now • Updated 7/28/2026
                  </p>
                </div>
              </div>
              <div className="text-2xl font-serif-orn text-[var(--ornament-text)]">
                $13.99 <span className="text-gray-400 text-lg mx-1">–</span>{" "}
                $16.99
              </div>
            </CardContent>
          </Card>

          <Card className="bg-purple-50/40 border-purple-200/60 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-[var(--ai-purple)]" />
                <span className="text-sm font-semibold text-[var(--ornament-text)]">
                  AI Collector Appraisal
                </span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">
                "The 2016 Sweet Decade Snowman currently appraises for $10–$18.
                Modest market value due to its recent year and common theme."
              </p>
            </CardContent>
          </Card>

          <div className="bg-white border border-[var(--ornament-card-border)] rounded-lg p-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <div className="text-xs font-medium text-[var(--ornament-muted)] uppercase tracking-wider">
                  Book Value
                </div>
                <div className="text-lg font-serif-orn font-semibold text-[var(--ornament-text)]">
                  $16.99
                </div>
              </div>
            </div>
            <Badge
              variant="outline"
              className="text-xs bg-gray-50 text-gray-500 font-normal"
            >
              Source: HooH
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
