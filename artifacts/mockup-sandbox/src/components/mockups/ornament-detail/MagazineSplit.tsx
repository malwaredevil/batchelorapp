import React from "react";
import {
  RefreshCw,
  Download,
  Edit3,
  Trash2,
  Plus,
  ArrowRight,
  ExternalLink,
  TrendingUp,
  Search,
} from "lucide-react";

export function MagazineSplit() {
  return (
    <div className="w-full bg-[#FAFAFA] text-stone-900 font-sans flex flex-col antialiased">
      {/* Hero Section */}
      <section className="w-full flex flex-col md:flex-row bg-[#1c1917] text-[#FDFBF7] min-h-[50vh]">
        {/* Left: Primary Photo */}
        <div className="w-full md:w-1/2 flex items-center justify-center p-8 bg-gradient-to-br from-[#3b2a22] to-[#1c1917] border-r border-stone-800/50">
          <div className="w-full max-w-md aspect-square bg-gradient-to-tr from-rose-200/20 to-teal-100/10 rounded-lg shadow-2xl flex items-center justify-center overflow-hidden border border-stone-700/50 relative">
            <div className="absolute inset-0 bg-stone-900/10 mix-blend-overlay"></div>
            <div className="w-3/4 h-3/4 rounded-full bg-gradient-to-tr from-white/10 to-transparent blur-2xl"></div>
            <span className="text-stone-400 font-medium tracking-widest uppercase text-sm z-10">
              Main Photo Placeholder
            </span>
          </div>
        </div>

        {/* Right: Title & Facts */}
        <div className="w-full md:w-1/2 flex items-center p-12 lg:p-20">
          <div className="max-w-xl w-full flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-[#a8a29e] tracking-[0.2em] text-xs font-semibold uppercase">
                Hallmark &middot; 2016
              </h2>
              <h1 className="text-5xl lg:text-6xl font-serif tracking-tight leading-tight text-[#FDFBF7]">
                2016 Sweet Decade Snowman
              </h1>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-4 py-4">
              <button className="h-10 w-10 rounded-full bg-stone-800 hover:bg-stone-700 text-stone-300 flex items-center justify-center transition-colors">
                <RefreshCw className="w-4 h-4" />
              </button>
              <button className="h-10 w-10 rounded-full bg-stone-800 hover:bg-stone-700 text-stone-300 flex items-center justify-center transition-colors">
                <Download className="w-4 h-4" />
              </button>
              <button className="h-10 w-10 rounded-full bg-stone-800 hover:bg-stone-700 text-stone-300 flex items-center justify-center transition-colors">
                <Edit3 className="w-4 h-4" />
              </button>
              <button className="h-10 w-10 rounded-full bg-stone-800 hover:bg-red-900/50 text-stone-300 hover:text-red-400 flex items-center justify-center transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Key Facts */}
            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-stone-800">
              <div className="flex flex-col gap-1">
                <span className="text-stone-500 text-[10px] uppercase tracking-wider font-semibold">
                  Year
                </span>
                <span className="text-lg font-medium text-stone-200">2016</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-stone-500 text-[10px] uppercase tracking-wider font-semibold">
                  Series
                </span>
                <span className="text-lg font-medium text-stone-200">
                  Sweet Decade
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-stone-500 text-[10px] uppercase tracking-wider font-semibold">
                  Book Value
                </span>
                <span className="text-lg font-medium text-stone-200">
                  $16.99
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Thumbnail Strip */}
      <section className="w-full px-8 py-6 border-b border-stone-200 bg-white">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <div className="h-20 w-20 rounded-md bg-stone-100 border border-stone-200 overflow-hidden shadow-sm flex items-center justify-center relative ring-2 ring-stone-900/5 ring-offset-2 ring-offset-white">
            <div className="w-full h-full bg-gradient-to-br from-rose-100/50 to-teal-50/50"></div>
          </div>
          <div className="h-20 w-20 rounded-md bg-stone-100 border border-stone-200 overflow-hidden shadow-sm flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity">
            <div className="w-full h-full bg-gradient-to-tr from-stone-200 to-stone-100"></div>
          </div>
          <div className="h-20 w-20 rounded-md bg-stone-100 border border-stone-200 overflow-hidden shadow-sm flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity">
            <div className="w-full h-full bg-gradient-to-tr from-stone-200 to-stone-100"></div>
          </div>
          <div className="h-full w-[1px] bg-stone-200 mx-2"></div>
          <button className="h-20 w-20 rounded-md border border-dashed border-stone-300 hover:border-stone-400 hover:bg-stone-50 flex items-center justify-center text-stone-400 hover:text-stone-600 transition-colors">
            <Plus className="w-6 h-6" />
          </button>
        </div>
      </section>

      {/* Main Content Columns */}
      <section className="max-w-7xl mx-auto w-full px-8 py-16 grid grid-cols-1 md:grid-cols-2 gap-16 lg:gap-24">
        {/* Left Column: Descriptive Data */}
        <div className="flex flex-col gap-12">
          {/* AI Description */}
          <div className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-stone-400">
              AI Description
            </h3>
            <p className="text-lg leading-relaxed text-stone-700 font-serif">
              "This whimsical ornament features a festive snowman surrounded by
              sparkling, candy-like numbers forming '2016'. The snowman sports a
              red hat and a colorful striped scarf. Part of the Sweet Decade
              series."
            </p>
          </div>

          <hr className="border-stone-200" />

          {/* Color Palette */}
          <div className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-stone-400">
              Color Palette
            </h3>
            <div className="flex items-center gap-6">
              {[
                { name: "White", hex: "#ffffff" },
                { name: "Red", hex: "#ef4444" },
                { name: "Green", hex: "#22c55e" },
                { name: "Yellow", hex: "#eab308" },
                { name: "Purple", hex: "#a855f7" },
              ].map((color) => (
                <div
                  key={color.name}
                  className="flex flex-col items-center gap-2 group cursor-pointer"
                >
                  <div
                    className="w-10 h-10 rounded-full shadow-inner border border-stone-200 group-hover:scale-110 transition-transform"
                    style={{ backgroundColor: color.hex }}
                  />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500">
                    {color.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Motif Tags */}
          <div className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-stone-400">
              Motifs
            </h3>
            <div className="flex flex-wrap gap-2">
              {["Snowman", "Numbers", "Candy", "Hat", "Scarf"].map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1.5 bg-stone-100 text-stone-600 rounded-full text-xs font-medium tracking-wide border border-stone-200/50"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Market Data & Actions */}
        <div className="flex flex-col gap-8">
          {/* eBay Market Data Card */}
          <div className="p-8 bg-[#fffaf0] border border-[#f3e8d3] rounded-xl flex flex-col gap-6 shadow-sm">
            <div className="flex justify-between items-start">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-amber-800/70">
                  eBay Market Data
                </h3>
                <span className="text-xs text-amber-900/50 font-medium">
                  Updated 7/28/2026
                </span>
              </div>
              <TrendingUp className="w-5 h-5 text-amber-600" />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-serif text-amber-950">
                  $13.99
                </span>
                <span className="text-xl font-serif text-amber-900/50">
                  – $16.99
                </span>
              </div>
              <span className="text-xs font-medium uppercase tracking-widest text-amber-700/70">
                For Sale Now
              </span>
            </div>

            {/* Range Bar Graphic */}
            <div className="w-full pt-4">
              <div className="h-1.5 w-full bg-amber-100 rounded-full overflow-hidden flex relative">
                <div className="absolute left-[30%] right-[20%] h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full"></div>
                <div className="absolute left-[45%] top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full border border-amber-500 shadow-sm"></div>
              </div>
              <div className="flex justify-between mt-2 text-[10px] font-semibold text-amber-800/50 tracking-wider">
                <span>$5</span>
                <span>$25</span>
              </div>
            </div>
          </div>

          {/* AI Appraisal */}
          <div className="p-8 bg-white border border-stone-200 rounded-xl flex flex-col gap-4 shadow-sm">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-stone-400">
                AI Collector Appraisal
              </h3>
              <p className="text-stone-600 leading-relaxed text-sm">
                "The 2016 Sweet Decade Snowman currently appraises for{" "}
                <span className="font-semibold text-stone-900">$10–$18</span>.
                Modest market value due to its recent year and common theme."
              </p>
            </div>
          </div>

          {/* Action Links */}
          <div className="flex flex-col gap-3 pt-4">
            <button className="flex items-center justify-between w-full p-4 bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition-colors group">
              <div className="flex items-center gap-3">
                <Search className="w-5 h-5 text-stone-400 group-hover:text-stone-300" />
                <span className="font-medium tracking-wide text-sm">
                  Catalog Research
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-stone-400 group-hover:translate-x-1 transition-transform" />
            </button>
            <button className="flex items-center justify-between w-full p-4 bg-stone-100 text-stone-700 rounded-lg hover:bg-stone-200 transition-colors group border border-stone-200">
              <div className="flex items-center gap-3">
                <ExternalLink className="w-5 h-5 text-stone-400 group-hover:text-stone-500" />
                <span className="font-medium tracking-wide text-sm">
                  Collector Series DB
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-stone-400 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* Bottom Metadata Table Strip */}
      <section className="w-full border-t border-stone-200 bg-stone-50 py-8 px-8 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-12 lg:gap-24 text-sm">
          <div className="flex flex-col gap-2 min-w-[120px]">
            <span className="font-semibold uppercase tracking-widest text-stone-400 text-[10px]">
              Brand
            </span>
            <span className="font-medium text-stone-800">Hallmark</span>
          </div>
          <div className="flex flex-col gap-2 min-w-[120px]">
            <span className="font-semibold uppercase tracking-widest text-stone-400 text-[10px]">
              Condition
            </span>
            <span className="font-medium text-stone-800">Mint in Box</span>
          </div>
          <div className="flex flex-col gap-2 min-w-[120px]">
            <span className="font-semibold uppercase tracking-widest text-stone-400 text-[10px]">
              Dimensions
            </span>
            <span className="font-medium text-stone-800">3.5 in</span>
          </div>
          <div className="flex flex-col gap-2 min-w-[120px]">
            <span className="font-semibold uppercase tracking-widest text-stone-400 text-[10px]">
              Barcode / UPC
            </span>
            <span className="font-medium text-stone-800 font-mono tracking-tight">
              661127022308
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
