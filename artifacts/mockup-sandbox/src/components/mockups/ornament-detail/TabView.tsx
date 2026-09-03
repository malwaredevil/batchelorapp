import React, { useState } from "react";
import {
  RefreshCw,
  FileText,
  Pencil,
  Trash2,
  Lock,
  Plus,
  Sparkles,
  Database,
  TrendingUp,
  Search,
} from "lucide-react";
import "./_group.css";

const ORNAMENT = {
  name: "2016 Sweet Decade Snowman",
  subtitle: "HALLMARK · 2016",
  brand: "Hallmark",
  year: "2016",
  series: "Sweet Decade",
  dimensions: "3.5 in",
  barcode: "661127022308",
  aiDescription:
    "This whimsical ornament features a festive snowman surrounded by sparkling, candy-like numbers forming '2016'. The snowman sports a red hat and a colorful striped scarf. Part of the Sweet Decade series.",
  colors: ["#ffffff", "#ef4444", "#22c55e", "#eab308", "#a855f7"],
  motifs: ["snowman", "numbers", "candy", "hat", "scarf"],
  ebayPrice: "$13.99 – $16.99",
  ebayUpdated: "7/28/2026",
  aiAppraisal:
    "The 2016 Sweet Decade Snowman currently appraises for $10–$18. Modest market value due to its recent year and common theme.",
  bookValue: "$16.99",
  bookSource: "HooH",
};

export function TabView() {
  const [activeTab, setActiveTab] = useState("details");

  return (
    <div className="bg-neutral-50/50 w-full text-neutral-900 font-sans">
      {/* Sticky Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-neutral-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
              {ORNAMENT.name}
            </h1>
            <p className="text-sm font-medium text-neutral-500 mt-1 tracking-wider">
              {ORNAMENT.subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-full transition-colors"
              aria-label="Refresh all data"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              className="p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-full transition-colors"
              aria-label="Download PDF"
            >
              <FileText className="w-5 h-5" />
            </button>
            <button
              className="p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-full transition-colors"
              aria-label="Edit"
            >
              <Pencil className="w-5 h-5" />
            </button>
            <button
              className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full transition-colors"
              aria-label="Delete"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex overflow-x-auto hide-scrollbar">
          <nav className="flex space-x-8" aria-label="Tabs">
            {[
              { id: "details", label: "Photos & Details" },
              { id: "ai", label: "AI Insights" },
              { id: "market", label: "Market Value" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? "border-[#c2714a] text-[#c2714a]"
                    : "border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-12">
          {/* Tab 1: Details */}
          <div
            className={
              activeTab === "details"
                ? "block"
                : "hidden opacity-50 pointer-events-none"
            }
          >
            <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
              {/* Left 55% Photo gallery */}
              <div className="lg:w-[55%] space-y-4">
                <div className="aspect-[4/5] w-full rounded-2xl bg-gradient-to-br from-neutral-200 to-neutral-300 overflow-hidden shadow-inner flex items-center justify-center">
                  <span className="text-neutral-400 font-medium">
                    Primary Photo
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-4">
                  <div className="aspect-square rounded-xl bg-neutral-200 flex items-center justify-center">
                    <span className="text-neutral-400 text-xs font-medium">
                      Side
                    </span>
                  </div>
                  <div className="aspect-square rounded-xl bg-neutral-200 flex items-center justify-center">
                    <span className="text-neutral-400 text-xs font-medium">
                      Back
                    </span>
                  </div>
                  <div className="aspect-square rounded-xl border-2 border-dashed border-neutral-300 hover:border-[#c2714a] hover:bg-[#c2714a]/5 transition-colors flex flex-col items-center justify-center cursor-pointer text-neutral-500 hover:text-[#c2714a]">
                    <Plus className="w-6 h-6 mb-1" />
                    <span className="text-xs font-medium">Add Photo</span>
                  </div>
                </div>
              </div>

              {/* Right 45% Metadata fields */}
              <div className="lg:w-[45%] flex flex-col">
                <div className="bg-white rounded-2xl p-6 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] border border-neutral-100 flex-grow">
                  <h3 className="text-lg font-semibold text-neutral-900 mb-6">
                    Ornament Details
                  </h3>
                  <dl className="space-y-0">
                    {[
                      { label: "Brand", value: ORNAMENT.brand },
                      { label: "Year", value: ORNAMENT.year },
                      { label: "Series / Collection", value: ORNAMENT.series },
                      { label: "Dimensions", value: ORNAMENT.dimensions },
                      { label: "Barcode / UPC", value: ORNAMENT.barcode },
                    ].map((item, idx) => (
                      <div
                        key={item.label}
                        className={`py-4 flex items-center justify-between group ${idx !== 0 ? "border-t border-neutral-100" : ""}`}
                      >
                        <dt className="text-sm text-neutral-500 font-medium">
                          {item.label}
                        </dt>
                        <dd className="text-sm text-neutral-900 font-medium flex items-center gap-2">
                          {item.value}
                          <Lock className="w-3.5 h-3.5 text-neutral-300 group-hover:text-neutral-400 transition-colors" />
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-8 pt-6 border-t border-neutral-100">
                    <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                      Categories
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-neutral-100 text-neutral-800">
                        Holiday
                      </span>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-neutral-100 text-neutral-800">
                        Snowmen
                      </span>
                      <span className="inline-flex items-center px-2.5 py-1 border border-dashed border-neutral-300 text-neutral-500 rounded-md text-xs font-medium hover:bg-neutral-50 cursor-pointer">
                        <Plus className="w-3 h-3 mr-1" /> Add
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tab 2: AI Insights */}
          <div
            className={
              activeTab === "ai"
                ? "block"
                : "hidden opacity-50 pointer-events-none"
            }
          >
            <div className="space-y-6">
              {/* AI Description Card */}
              <div className="bg-white rounded-2xl p-8 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-neutral-100">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-5 h-5 text-indigo-500" />
                  <h3 className="text-lg font-semibold text-neutral-900">
                    AI Analysis
                  </h3>
                </div>
                <p className="text-lg text-neutral-700 leading-relaxed max-w-4xl">
                  "{ORNAMENT.aiDescription}"
                </p>

                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <h4 className="text-sm font-medium text-neutral-500 mb-3">
                      Detected Palette
                    </h4>
                    <div className="flex items-center gap-3">
                      {ORNAMENT.colors.map((color, i) => (
                        <div
                          key={i}
                          className="w-8 h-8 rounded-full border border-black/10 shadow-sm"
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-neutral-500 mb-3">
                      Identified Motifs
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {ORNAMENT.motifs.map((motif, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-indigo-50 text-indigo-700 border border-indigo-100/50"
                        >
                          {motif}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* AI Catalog Research */}
                <div className="bg-gradient-to-br from-indigo-900 to-purple-900 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2">
                      <Search className="w-5 h-5 text-indigo-300" />
                      <h3 className="text-lg font-semibold">
                        Deep Catalog Search
                      </h3>
                    </div>
                    <p className="text-indigo-200 text-sm mb-6 max-w-sm">
                      Run an AI agent to cross-reference this ornament against
                      50+ years of Hallmark catalogs and historical archives.
                    </p>
                    <button className="bg-white text-indigo-900 px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-indigo-50 transition-colors shadow-sm w-full sm:w-auto">
                      Run Research Agent
                    </button>
                  </div>
                  <div className="absolute -bottom-10 -right-10 opacity-10">
                    <Search className="w-48 h-48" />
                  </div>
                </div>

                {/* Collector Series */}
                <div className="bg-white rounded-2xl p-6 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.05)] border border-neutral-100 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <Database className="w-5 h-5 text-emerald-500" />
                      <h3 className="text-lg font-semibold text-neutral-900">
                        Series Context
                      </h3>
                    </div>
                    <p className="text-sm text-neutral-600 mb-4">
                      This item belongs to the{" "}
                      <span className="font-semibold text-neutral-900">
                        Sweet Decade
                      </span>{" "}
                      series. You own 3 of the 12 known items in this
                      collection.
                    </p>
                  </div>
                  <button className="text-sm font-medium text-emerald-600 hover:text-emerald-700 self-start">
                    View full series details &rarr;
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Tab 3: Market Value */}
          <div
            className={
              activeTab === "market"
                ? "block"
                : "hidden opacity-50 pointer-events-none"
            }
          >
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* eBay Market Data */}
                <div className="bg-gradient-to-br from-amber-50 to-yellow-50/50 rounded-2xl p-8 border border-amber-100 shadow-sm relative overflow-hidden">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-amber-600" />
                      <h3 className="text-lg font-semibold text-neutral-900">
                        Live Market Data
                      </h3>
                    </div>
                    <span className="text-xs font-medium text-amber-600 bg-amber-100/50 px-2 py-1 rounded-md">
                      eBay
                    </span>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-neutral-500 mb-1">
                      Current Active Listings
                    </p>
                    <div className="text-4xl font-bold text-neutral-900 tracking-tight">
                      {ORNAMENT.ebayPrice}
                    </div>
                    <p className="text-xs text-neutral-400 mt-2">
                      Last updated {ORNAMENT.ebayUpdated}
                    </p>
                  </div>
                  <div className="absolute -bottom-8 -right-8 opacity-[0.03]">
                    <TrendingUp className="w-40 h-40" />
                  </div>
                </div>

                {/* AI Appraisal */}
                <div className="bg-gradient-to-br from-fuchsia-50 to-purple-50/50 rounded-2xl p-8 border border-fuchsia-100 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-5 h-5 text-fuchsia-600" />
                    <h3 className="text-lg font-semibold text-neutral-900">
                      Expert Appraisal
                    </h3>
                  </div>
                  <p className="text-neutral-700 leading-relaxed text-[15px]">
                    {ORNAMENT.aiAppraisal}
                  </p>
                </div>
              </div>

              {/* Book Value Attribution */}
              <div className="flex items-center justify-center p-6 bg-white rounded-xl border border-neutral-100 shadow-sm">
                <p className="text-sm text-neutral-500">
                  Historical Book Value:{" "}
                  <span className="font-semibold text-neutral-900">
                    {ORNAMENT.bookValue}
                  </span>
                  <span className="mx-2 text-neutral-300">|</span>
                  Source:{" "}
                  <span className="font-medium text-neutral-700">
                    {ORNAMENT.bookSource}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
