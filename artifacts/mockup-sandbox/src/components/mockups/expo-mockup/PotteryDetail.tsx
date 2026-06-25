import { ArrowLeft, MoreVertical, Sparkles, Trash2, Camera, Star, Lock, Share2, ChevronRight, RefreshCcw } from "lucide-react";

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-5 shrink-0 absolute top-0 left-0 right-0 z-20" style={{ height: 28 }}>
      <span className="text-amber-100 text-[11px] font-semibold tracking-wide drop-shadow">12:52</span>
      <div className="flex items-center gap-1.5">
        <div className="flex gap-[2px] items-end h-3">
          {[3,4,5,6].map((h,i) => <div key={i} style={{height:`${h*2}px`}} className="w-[3px] bg-amber-100 rounded-sm"/>)}
        </div>
        <svg width="14" height="10" viewBox="0 0 14 10" fill="#FEF3C7"><rect x="0" y="0" width="12" height="10" rx="2" stroke="#FEF3C7" strokeWidth="1" fill="none"/><rect x="1" y="1" width="8" height="8" rx="1" fill="#FEF3C7"/><rect x="12.5" y="3" width="1.5" height="4" rx="0.5" fill="#FEF3C7"/></svg>
      </div>
    </div>
  );
}

const aiTags = ["Celadon","Glazed","Bowl","Song Dynasty","Stoneware","Collector's Grade"];
const colors = ["#8FBC8F","#4A7C4A","#C5DEC5","#2D5A2D","#E8F5E8"];

export function PotteryDetail() {
  return (
    <div className="flex flex-col w-full h-screen overflow-hidden relative" style={{ fontFamily: "'Inter', system-ui, sans-serif", backgroundColor: "#1C1007" }}>
      {/* Hero */}
      <div className="relative shrink-0" style={{ height: 290 }}>
        <div className="absolute inset-0" style={{ background: "linear-gradient(160deg, #2D5A2D 0%, #8FBC8F 50%, #C5DEC5 100%)" }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <span style={{ fontSize: 100 }}>🏺</span>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16" style={{ background: "linear-gradient(to top, #1C1007, transparent)" }} />

        <StatusBar />

        {/* Nav overlay */}
        <div className="absolute top-9 left-0 right-0 flex items-center justify-between px-4 z-10">
          <button className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
            <ArrowLeft size={18} className="text-white" />
          </button>
          <div className="flex gap-2">
            <button className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
              <Camera size={16} className="text-amber-200" />
            </button>
            <button className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
              <MoreVertical size={16} className="text-white" />
            </button>
          </div>
        </div>

        {/* Photo strip */}
        <div className="absolute bottom-3 left-4 flex gap-1.5">
          {["🏺","🏺","🏺"].map((e, i) => (
            <div key={i} className={`w-10 h-10 rounded-lg flex items-center justify-center border-2 text-lg ${i === 0 ? "border-amber-400" : "border-transparent"}`}
              style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
              {e}
            </div>
          ))}
          <button className="w-10 h-10 rounded-lg flex items-center justify-center border-2 border-dashed border-amber-700"
            style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
            <Camera size={14} className="text-amber-400" />
          </button>
        </div>
      </div>

      {/* Detail scroll */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-3 pb-24">
          {/* Title */}
          <div className="flex items-start justify-between mb-1">
            <div className="flex-1">
              <h1 className="text-[22px] font-bold text-amber-100 leading-tight">Celadon Bowl</h1>
              <p className="text-[13px] text-amber-600 mt-0.5">Hamada Shōji · c.1962</p>
            </div>
            <button className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(217,119,6,0.15)" }}>
              <Star size={18} className="text-amber-400" />
            </button>
          </div>

          {/* Color palette */}
          <div className="mt-3">
            <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-widest mb-2">Dominant Colors</p>
            <div className="flex gap-2">
              {colors.map((c, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="w-9 h-9 rounded-xl border border-amber-900" style={{ backgroundColor: c }} />
                </div>
              ))}
            </div>
          </div>

          {/* AI tags */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {aiTags.map((t) => (
              <span key={t} className="px-2.5 py-1 rounded-full text-[11px] font-medium border border-amber-800 text-amber-400"
                style={{ backgroundColor: "rgba(217,119,6,0.1)" }}>
                {t}
              </span>
            ))}
          </div>

          {/* AI description */}
          <div className="mt-4 rounded-2xl p-4 border border-amber-900" style={{ backgroundColor: "rgba(217,119,6,0.08)" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Sparkles size={14} className="text-amber-400" />
                <span className="text-[12px] font-semibold text-amber-400 uppercase tracking-wide">AI Analysis</span>
              </div>
              <button className="flex items-center gap-1 text-amber-600 text-[10px]">
                <Lock size={10} /> Locked
              </button>
            </div>
            <p className="text-[13px] leading-relaxed text-amber-200">
              A refined celadon-glazed stoneware bowl with a subtle crackling surface and pale jade-green glaze. The form shows Hamada's characteristic restraint — slightly irregular rim, foot ring with exposed clay body.
            </p>
          </div>

          {/* Details */}
          <div className="mt-3 rounded-2xl border border-amber-900 overflow-hidden" style={{ backgroundColor: "#2C1A0A" }}>
            {[
              { label: "Form", value: "Bowl" },
              { label: "Glaze", value: "Celadon" },
              { label: "Origin", value: "Japan" },
              { label: "Dimensions", value: "14 × 8 cm" },
              { label: "Condition", value: "Excellent" },
            ].map((row, i, arr) => (
              <div key={row.label} className={`flex items-center justify-between px-4 py-3 ${i < arr.length - 1 ? "border-b border-amber-950" : ""}`}>
                <span className="text-[12px] text-amber-700">{row.label}</span>
                <span className="text-[13px] font-medium text-amber-200">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="absolute bottom-0 left-0 right-0 px-4 py-3 flex items-center gap-3 border-t border-amber-950 shadow-lg" style={{ backgroundColor: "#1C1007" }}>
        <button className="flex-1 h-11 rounded-2xl flex items-center justify-center gap-2" style={{ backgroundColor: "#D97706" }}>
          <RefreshCcw size={16} className="text-white" />
          <span className="text-[14px] font-semibold text-white">Re-analyse</span>
        </button>
        <button className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
          <Share2 size={18} className="text-amber-300" />
        </button>
        <button className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "rgba(220,38,38,0.15)" }}>
          <Trash2 size={18} className="text-red-400" />
        </button>
      </div>
    </div>
  );
}
