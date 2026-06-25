import {
  ArrowLeft,
  MoreVertical,
  Sparkles,
  Trash2,
  Edit3,
  Share2,
  ChevronRight,
} from "lucide-react";

const STATUS_BAR_H = 28;

function StatusBar() {
  return (
    <div style={{ height: STATUS_BAR_H }} className="flex items-center justify-between px-5 shrink-0 absolute top-0 left-0 right-0 z-20">
      <span className="text-white text-[11px] font-semibold tracking-wide drop-shadow">12:46</span>
      <div className="flex items-center gap-1.5">
        <div className="flex gap-[2px] items-end h-3">
          {[3, 4, 5, 6].map((h, i) => (
            <div key={i} style={{ height: `${h * 2}px` }} className="w-[3px] bg-white rounded-sm" />
          ))}
        </div>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="white">
          <rect x="0" y="0" width="12" height="10" rx="2" stroke="white" strokeWidth="1" fill="none"/>
          <rect x="1" y="1" width="8" height="8" rx="1" fill="white"/>
          <rect x="12.5" y="3" width="1.5" height="4" rx="0.5" fill="white"/>
        </svg>
      </div>
    </div>
  );
}

const colors = ["#2D4A6B", "#6B9AC4", "#A8C5E2", "#1A2E40", "#D4E8F5"];
const tags = ["Floral", "Cotton", "Navy", "Large Print", "Modern"];

export function FabricDetail() {
  return (
    <div className="flex flex-col w-full h-screen bg-slate-50 overflow-hidden relative" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Hero image */}
      <div className="relative shrink-0" style={{ height: 280 }}>
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(135deg, #2D4A6B 0%, #6B9AC4 50%, #A8C5E2 100%)" }}
        >
          {/* Pattern simulation */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-9xl opacity-70">🌸</span>
          </div>
          <div className="absolute top-20 left-8 text-5xl opacity-30">🌸</div>
          <div className="absolute bottom-8 right-12 text-4xl opacity-20">🌸</div>
        </div>

        {/* Gradient scrim at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-16"
          style={{ background: "linear-gradient(to top, rgba(248,250,252,1), transparent)" }}
        />

        <StatusBar />

        {/* Nav overlay */}
        <div className="absolute top-9 left-0 right-0 flex items-center justify-between px-4 z-10">
          <button className="w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center">
            <ArrowLeft size={18} className="text-white" />
          </button>
          <div className="flex gap-2">
            <button className="w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center">
              <Share2 size={16} className="text-white" />
            </button>
            <button className="w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center">
              <MoreVertical size={16} className="text-white" />
            </button>
          </div>
        </div>

        {/* Fabric type badge */}
        <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1">
          <span className="text-[11px] font-semibold text-slate-700">COTTON · 44" wide</span>
        </div>
      </div>

      {/* Scrollable detail content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-3 pb-24">

          {/* Title row */}
          <div className="flex items-start justify-between mb-1">
            <div className="flex-1">
              <h1 className="text-[22px] font-bold text-slate-900 leading-tight">Midnight Florals</h1>
              <p className="text-[13px] text-slate-400 mt-0.5">Moda Fabrics · Garden Dreams line</p>
            </div>
            <div className="bg-teal-50 border border-teal-200 rounded-xl px-2.5 py-1.5 text-right shrink-0 ml-3">
              <p className="text-[17px] font-bold text-teal-700">2.5</p>
              <p className="text-[10px] text-teal-500 font-medium">yards</p>
            </div>
          </div>

          {/* Color palette */}
          <div className="mt-4">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Dominant Colors</p>
            <div className="flex gap-2">
              {colors.map((c, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="w-10 h-10 rounded-xl shadow-sm border border-slate-200"
                    style={{ backgroundColor: c }}
                  />
                  <span className="text-[9px] text-slate-400">{c}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="px-2.5 py-1 bg-white border border-slate-200 rounded-full text-[11px] font-medium text-slate-600 shadow-sm">
                {tag}
              </span>
            ))}
          </div>

          {/* AI Description */}
          <div className="mt-4 bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles size={14} className="text-violet-500" />
              <span className="text-[12px] font-semibold text-violet-500 uppercase tracking-wide">AI Description</span>
            </div>
            <p className="text-[13px] text-slate-600 leading-relaxed">
              A deep navy cotton fabric featuring large-scale floral motifs in soft dusty blues and cream. The flowing botanical print evokes a romantic garden aesthetic, ideal for quilt centres, statement blocks, or backing fabric.
            </p>
          </div>

          {/* Details list */}
          <div className="mt-3 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {[
              { label: "Print type", value: "Floral" },
              { label: "Fiber content", value: "100% Cotton" },
              { label: "Width", value: '44"' },
              { label: "Colorway", value: "Navy / Dusty Blue" },
              { label: "SKU", value: "MOD-4521-16" },
            ].map((row, i, arr) => (
              <div key={row.label} className={`flex items-center justify-between px-4 py-3 ${i < arr.length - 1 ? "border-b border-slate-50" : ""}`}>
                <span className="text-[12px] text-slate-400">{row.label}</span>
                <span className="text-[13px] font-medium text-slate-700">{row.value}</span>
              </div>
            ))}
          </div>

          {/* Categories */}
          <div className="mt-3 bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-slate-700">Categories</span>
              <div className="flex items-center gap-1 text-teal-500">
                <span className="text-[12px]">Backgrounds, Navy</span>
                <ChevronRight size={14} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-4 py-3 flex items-center gap-3 shadow-lg">
        <button className="flex-1 h-11 rounded-2xl bg-teal-600 flex items-center justify-center gap-2">
          <Sparkles size={16} className="text-white" />
          <span className="text-[14px] font-semibold text-white">Re-analyse</span>
        </button>
        <button className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center">
          <Edit3 size={18} className="text-slate-600" />
        </button>
        <button className="w-11 h-11 rounded-2xl bg-red-50 flex items-center justify-center">
          <Trash2 size={18} className="text-red-500" />
        </button>
      </div>
    </div>
  );
}
